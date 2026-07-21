use bytes::BytesMut;
use std::collections::HashMap;
use std::sync::Arc;
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::net::{TcpListener, TcpStream};
use tokio::sync::{Mutex, mpsc, oneshot};
use tracing::{debug, info, warn};

use crate::protocol::{Frame, FrameType};

pub struct SocksRelay {
    active_tunnels: Arc<Mutex<HashMap<String, TunnelHandle>>>,
}

struct TunnelHandle {
    port: u16,
    shutdown: oneshot::Sender<()>,
}

pub struct SocksConnection {
    pub relay_data_tx: mpsc::Sender<Vec<u8>>,
    pub connect_ack: Option<oneshot::Sender<bool>>,
}

impl SocksRelay {
    pub fn new() -> Self {
        Self {
            active_tunnels: Arc::new(Mutex::new(HashMap::new())),
        }
    }

    pub async fn start_tunnel(
        &self,
        session_name: &str,
        port: u16,
        frame_tx: mpsc::Sender<Frame>,
        socks_connections: Arc<Mutex<HashMap<u32, SocksConnection>>>,
    ) -> Result<(), String> {
        let addr = format!("127.0.0.1:{port}");
        let listener = TcpListener::bind(&addr)
            .await
            .map_err(|e| format!("failed to bind {addr}: {e}"))?;

        info!("SOCKS5 proxy listening on {addr} for session '{session_name}'");

        let (shutdown_tx, mut shutdown_rx) = oneshot::channel();
        {
            let mut tunnels = self.active_tunnels.lock().await;
            tunnels.insert(
                session_name.to_string(),
                TunnelHandle {
                    port,
                    shutdown: shutdown_tx,
                },
            );
        }

        let session = session_name.to_string();
        let tunnels = self.active_tunnels.clone();

        tokio::spawn(async move {
            // High bit set to avoid collision with session-level request IDs
            let mut request_counter = 0x8000_0000_u32;

            loop {
                tokio::select! {
                    result = listener.accept() => {
                        match result {
                            Ok((stream, peer)) => {
                                request_counter += 1;
                                let rid = request_counter;
                                debug!("SOCKS connection from {peer}, id={rid}");
                                let ftx = frame_tx.clone();
                                let conns = socks_connections.clone();
                                tokio::spawn(async move {
                                    handle_socks_client(stream, rid, ftx, conns).await;
                                });
                            }
                            Err(e) => {
                                warn!("SOCKS accept error: {e}");
                            }
                        }
                    }
                    _ = &mut shutdown_rx => {
                        info!("SOCKS tunnel for '{session}' shutting down");
                        break;
                    }
                }
            }

            tunnels.lock().await.remove(&session);
        });

        Ok(())
    }

    pub async fn stop_tunnel(&self, session_name: &str) -> Result<(), String> {
        let mut tunnels = self.active_tunnels.lock().await;
        match tunnels.remove(session_name) {
            Some(handle) => {
                let _ = handle.shutdown.send(());
                Ok(())
            }
            None => Err(format!("no active tunnel for '{session_name}'")),
        }
    }

    pub async fn list_tunnels(&self) -> Vec<(String, u16)> {
        let tunnels = self.active_tunnels.lock().await;
        tunnels
            .iter()
            .map(|(name, handle)| (name.clone(), handle.port))
            .collect()
    }
}

async fn handle_socks_client(
    mut stream: TcpStream,
    request_id: u32,
    frame_tx: mpsc::Sender<Frame>,
    connections: Arc<Mutex<HashMap<u32, SocksConnection>>>,
) {
    // SOCKS5 handshake
    let mut buf = [0u8; 258];
    if stream.read_exact(&mut buf[..2]).await.is_err() {
        return;
    }
    if buf[0] != 0x05 {
        return; // not SOCKS5
    }
    let nmethods = buf[1] as usize;
    if stream.read_exact(&mut buf[..nmethods]).await.is_err() {
        return;
    }
    // No auth required
    if stream.write_all(&[0x05, 0x00]).await.is_err() {
        return;
    }

    // Read connect request
    if stream.read_exact(&mut buf[..4]).await.is_err() {
        return;
    }
    if buf[1] != 0x01 {
        // Only CONNECT supported
        let _ = stream
            .write_all(&[0x05, 0x07, 0x00, 0x01, 0, 0, 0, 0, 0, 0])
            .await;
        return;
    }

    let target = match buf[3] {
        0x01 => {
            // IPv4
            if stream.read_exact(&mut buf[..6]).await.is_err() {
                return;
            }
            format!(
                "{}.{}.{}.{}:{}",
                buf[0],
                buf[1],
                buf[2],
                buf[3],
                u16::from_be_bytes([buf[4], buf[5]])
            )
        }
        0x03 => {
            // Domain
            if stream.read_exact(&mut buf[..1]).await.is_err() {
                return;
            }
            let domain_len = buf[0] as usize;
            if stream.read_exact(&mut buf[..domain_len + 2]).await.is_err() {
                return;
            }
            let domain = String::from_utf8_lossy(&buf[..domain_len]).to_string();
            let port = u16::from_be_bytes([buf[domain_len], buf[domain_len + 1]]);
            format!("{domain}:{port}")
        }
        0x04 => {
            // IPv6
            if stream.read_exact(&mut buf[..18]).await.is_err() {
                return;
            }
            let port = u16::from_be_bytes([buf[16], buf[17]]);
            let addr: std::net::Ipv6Addr = {
                let mut octets = [0u8; 16];
                octets.copy_from_slice(&buf[..16]);
                octets.into()
            };
            format!("[{addr}]:{port}")
        }
        _ => return,
    };

    debug!("SOCKS5 CONNECT to {target}, request_id={request_id}");

    // Ask the agent to open a connection
    let open_frame = Frame::new(
        FrameType::SocksOpen,
        request_id,
        BytesMut::from(target.as_bytes()),
    );
    if frame_tx.send(open_frame).await.is_err() {
        return;
    }

    // Register this connection and wait for agent to confirm the connect succeeded
    let (data_tx, mut data_rx) = mpsc::channel::<Vec<u8>>(64);
    let (ack_tx, ack_rx) = oneshot::channel::<bool>();
    {
        let mut conns = connections.lock().await;
        conns.insert(
            request_id,
            SocksConnection {
                relay_data_tx: data_tx,
                connect_ack: Some(ack_tx),
            },
        );
    }

    // Wait for agent's connect ack (5s timeout)
    let connected = matches!(
        tokio::time::timeout(std::time::Duration::from_secs(5), ack_rx).await,
        Ok(Ok(true))
    );

    if !connected {
        // SOCKS5 connection refused
        let reply = [0x05, 0x05, 0x00, 0x01, 0, 0, 0, 0, 0, 0];
        let _ = stream.write_all(&reply).await;
        connections.lock().await.remove(&request_id);
        return;
    }

    // Send SOCKS5 success response
    let reply = [0x05, 0x00, 0x00, 0x01, 0, 0, 0, 0, 0, 0];
    if stream.write_all(&reply).await.is_err() {
        connections.lock().await.remove(&request_id);
        return;
    }

    let (mut read_half, mut write_half) = stream.into_split();
    let ftx = frame_tx.clone();
    let rid = request_id;
    let conns_cleanup = connections.clone();

    // Client -> agent
    let read_handle = tokio::spawn(async move {
        let mut buf = vec![0u8; 8192];
        loop {
            match read_half.read(&mut buf).await {
                Ok(0) => break,
                Ok(n) => {
                    let frame = Frame::new(FrameType::SocksData, rid, BytesMut::from(&buf[..n]));
                    if ftx.send(frame).await.is_err() {
                        break;
                    }
                }
                Err(_) => break,
            }
        }
        let _ = frame_tx
            .send(Frame::new(FrameType::SocksClose, rid, BytesMut::new()))
            .await;
        conns_cleanup.lock().await.remove(&rid);
    });

    // Agent -> client
    tokio::spawn(async move {
        while let Some(data) = data_rx.recv().await {
            if write_half.write_all(&data).await.is_err() {
                break;
            }
        }
        read_handle.abort();
    });
}
