use bytes::BytesMut;
use std::collections::HashMap;
use std::sync::Arc;
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::net::TcpStream;
use tokio::sync::{Mutex, mpsc};
use tracing::debug;

use crate::protocol::{Frame, FrameType};

pub struct SocksAgent {
    connections: Arc<Mutex<HashMap<u32, mpsc::Sender<Vec<u8>>>>>,
}

impl SocksAgent {
    pub fn new() -> Self {
        Self {
            connections: Arc::new(Mutex::new(HashMap::new())),
        }
    }

    pub async fn handle_open(
        &self,
        request_id: u32,
        payload: &[u8],
        relay_tx: mpsc::Sender<Frame>,
    ) {
        let target = match std::str::from_utf8(payload) {
            Ok(s) => s.to_string(),
            Err(_) => {
                let _ = relay_tx
                    .send(Frame::error(request_id, "invalid target address"))
                    .await;
                return;
            }
        };

        debug!("socks open {request_id}: connecting to {target}");

        let stream = match TcpStream::connect(&target).await {
            Ok(s) => s,
            Err(e) => {
                let _ = relay_tx
                    .send(Frame::error(request_id, &format!("connect failed: {e}")))
                    .await;
                return;
            }
        };

        // Signal success
        let _ = relay_tx
            .send(Frame::new(
                FrameType::SocksOpen,
                request_id,
                BytesMut::from("ok".as_bytes()),
            ))
            .await;

        let (mut read_half, mut write_half) = stream.into_split();
        let (data_tx, mut data_rx) = mpsc::channel::<Vec<u8>>(64);

        {
            let mut conns = self.connections.lock().await;
            conns.insert(request_id, data_tx);
        }

        let conns_write = self.connections.clone();
        let relay_tx_read = relay_tx.clone();
        let rid = request_id;

        // Target -> relay
        let read_handle = tokio::spawn(async move {
            let mut buf = vec![0u8; 8192];
            loop {
                match read_half.read(&mut buf).await {
                    Ok(0) => break,
                    Ok(n) => {
                        let frame =
                            Frame::new(FrameType::SocksData, rid, BytesMut::from(&buf[..n]));
                        if relay_tx_read.send(frame).await.is_err() {
                            break;
                        }
                    }
                    Err(_) => break,
                }
            }
            let _ = relay_tx_read
                .send(Frame::new(FrameType::SocksClose, rid, BytesMut::new()))
                .await;
            conns_write.lock().await.remove(&rid);
        });

        // Relay -> target
        tokio::spawn(async move {
            while let Some(data) = data_rx.recv().await {
                if write_half.write_all(&data).await.is_err() {
                    break;
                }
            }
            read_handle.abort();
        });
    }

    pub async fn handle_data(&self, request_id: u32, data: &[u8]) {
        let tx = {
            let conns = self.connections.lock().await;
            conns.get(&request_id).cloned()
        };
        if let Some(tx) = tx {
            let _ = tx.send(data.to_vec()).await;
        }
    }

    pub async fn handle_close(&self, request_id: u32) {
        let mut conns = self.connections.lock().await;
        conns.remove(&request_id);
    }
}
