use std::collections::HashMap;
use std::sync::atomic::{AtomicUsize, Ordering};
use std::sync::Arc;
use std::time::{Duration, Instant};

use serde::Serialize;
use tokio::net::TcpListener;
use tokio::sync::Mutex;
use tokio::task::JoinHandle;
use tracing::{debug, info, warn};

use crate::session::{BoxedStream, SessionManager};

/// PKRL protocol magic bytes (first 4 bytes of any native agent connection).
const PKRL_MAGIC: u32 = 0x504B524C;

const MAX_CONNECTIONS_PER_LISTENER: usize = 64;

/// Supported listener protocol modes.
/// For now all modes accept PKRL agent connections; raw/http are stubs.
#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum ListenerMode {
    Agent,
    Raw,
    Http,
}

impl ListenerMode {
    pub fn from_str(s: &str) -> Result<Self, String> {
        match s {
            "agent" => Ok(Self::Agent),
            "raw" => Ok(Self::Raw),
            "http" => Ok(Self::Http),
            other => Err(format!("unknown listener mode: '{other}'")),
        }
    }

    pub fn as_str(&self) -> &'static str {
        match self {
            Self::Agent => "agent",
            Self::Raw => "raw",
            Self::Http => "http",
        }
    }
}

/// Status of a listener.
#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum ListenerStatus {
    Running,
    Stopped,
}

/// Public info about a listener, returned by list/get APIs.
#[derive(Debug, Clone, Serialize)]
pub struct ListenerInfo {
    pub id: String,
    pub port: u16,
    pub mode: String,
    pub bind: String,
    pub name_prefix: String,
    #[serde(serialize_with = "serialize_instant_as_secs")]
    pub created_at: Instant,
    pub connections: usize,
    pub status: String,
}

fn serialize_instant_as_secs<S: serde::Serializer>(
    instant: &Instant,
    serializer: S,
) -> Result<S::Ok, S::Error> {
    serializer.serialize_u64(instant.elapsed().as_secs())
}

/// Internal state for a running listener.
struct RunningListener {
    id: String,
    port: u16,
    mode: ListenerMode,
    bind: String,
    name_prefix: String,
    created_at: Instant,
    connections: Arc<AtomicUsize>,
    handle: JoinHandle<()>,
}

impl RunningListener {
    fn to_info(&self) -> ListenerInfo {
        ListenerInfo {
            id: self.id.clone(),
            port: self.port,
            mode: self.mode.as_str().to_string(),
            bind: self.bind.clone(),
            name_prefix: self.name_prefix.clone(),
            created_at: self.created_at,
            connections: self.connections.load(Ordering::Relaxed),
            status: if self.handle.is_finished() {
                ListenerStatus::Stopped.as_str()
            } else {
                ListenerStatus::Running.as_str()
            }
            .to_string(),
        }
    }
}

impl ListenerStatus {
    fn as_str(&self) -> &'static str {
        match self {
            Self::Running => "running",
            Self::Stopped => "stopped",
        }
    }
}

#[cfg(feature = "tls")]
pub struct TlsConfig {
    pub acceptor: tokio_rustls::TlsAcceptor,
}

/// Manages multiple TCP listeners, each running in its own tokio task.
pub struct ListenerManager {
    listeners: Mutex<HashMap<String, RunningListener>>,
    session_manager: Arc<SessionManager>,
    #[cfg(feature = "tls")]
    tls: Option<Arc<TlsConfig>>,
    #[cfg(not(feature = "tls"))]
    _phantom: (),
}

impl ListenerManager {
    pub fn new(
        session_manager: Arc<SessionManager>,
        #[cfg(feature = "tls")] tls: Option<TlsConfig>,
    ) -> Self {
        Self {
            listeners: Mutex::new(HashMap::new()),
            session_manager,
            #[cfg(feature = "tls")]
            tls: tls.map(Arc::new),
            #[cfg(not(feature = "tls"))]
            _phantom: (),
        }
    }

    /// Create and start a new listener. Binds immediately; returns error if the port is unavailable.
    /// Port 0 lets the OS pick an available port.
    pub async fn create(
        &self,
        port: u16,
        mode: ListenerMode,
        bind: String,
        name_prefix: String,
    ) -> Result<ListenerInfo, String> {
        let addr = format!("{bind}:{port}");
        let tcp_listener = TcpListener::bind(&addr)
            .await
            .map_err(|e| format!("failed to bind {addr}: {e}"))?;

        // Resolve the actual port (matters when port == 0)
        let actual_port = tcp_listener
            .local_addr()
            .map(|a| a.port())
            .unwrap_or(port);

        let id = format!("lst-{}", short_uuid());
        let connections = Arc::new(AtomicUsize::new(0));
        let created_at = Instant::now();

        let mgr = self.session_manager.clone();
        let counter = connections.clone();
        let accept_mode = mode.clone();
        let accept_prefix = name_prefix.clone();

        #[cfg(feature = "tls")]
        let tls = self.tls.clone();

        #[cfg(feature = "tls")]
        let tls_label = if tls.is_some() { " (TLS)" } else { "" };
        #[cfg(not(feature = "tls"))]
        let tls_label = "";

        let listener_id = id.clone();
        info!(
            "listener {listener_id} started on {bind}:{actual_port}{tls_label} mode={}",
            mode.as_str()
        );

        let handle = tokio::spawn(async move {
            accept_loop(
                tcp_listener,
                mgr,
                counter,
                accept_mode,
                accept_prefix,
                #[cfg(feature = "tls")]
                tls,
            )
            .await;
        });

        let running = RunningListener {
            id: id.clone(),
            port: actual_port,
            mode,
            bind: bind.clone(),
            name_prefix,
            created_at,
            connections,
            handle,
        };

        let info = running.to_info();
        self.listeners.lock().await.insert(id, running);
        Ok(info)
    }

    /// List all listeners (running or stopped).
    pub async fn list(&self) -> Vec<ListenerInfo> {
        let listeners = self.listeners.lock().await;
        listeners.values().map(|l| l.to_info()).collect()
    }

    /// Get info for a single listener.
    pub async fn get(&self, id: &str) -> Option<ListenerInfo> {
        let listeners = self.listeners.lock().await;
        listeners.get(id).map(|l| l.to_info())
    }

    /// Close a listener: abort its task and remove it from the map.
    pub async fn close(&self, id: &str) -> Result<(), String> {
        let mut listeners = self.listeners.lock().await;
        match listeners.remove(id) {
            Some(running) => {
                running.handle.abort();
                info!("listener {id} closed (port {})", running.port);
                Ok(())
            }
            None => Err(format!("listener '{id}' not found")),
        }
    }
}

/// The accept loop extracted from the old `start()` function.
/// Runs until the task is aborted or a fatal error occurs.
///
/// When `mode` is `Raw`, all connections are treated as raw TCP sessions.
/// Otherwise, the first bytes are peeked to auto-detect whether the connection
/// speaks PKRL (native agent) or is a raw shell (bash, netcat, etc.).
async fn accept_loop(
    listener: TcpListener,
    manager: Arc<SessionManager>,
    active: Arc<AtomicUsize>,
    mode: ListenerMode,
    name_prefix: String,
    #[cfg(feature = "tls")] tls: Option<Arc<TlsConfig>>,
) {
    #[cfg(feature = "tls")]
    let tls_enabled = tls.is_some();
    #[cfg(not(feature = "tls"))]
    let tls_enabled = false;

    loop {
        match listener.accept().await {
            Ok((stream, peer)) => {
                let current = active.load(Ordering::Relaxed);
                if current >= MAX_CONNECTIONS_PER_LISTENER {
                    warn!("connection limit reached ({current}), rejecting {peer}");
                    drop(stream);
                    continue;
                }

                let sock_ref = socket2::SockRef::from(&stream);
                let keepalive = socket2::TcpKeepalive::new()
                    .with_time(Duration::from_secs(5))
                    .with_interval(Duration::from_secs(2));
                if let Err(e) = sock_ref.set_tcp_keepalive(&keepalive) {
                    warn!("failed to set TCP keepalive for {peer}: {e}");
                }
                let _ = stream.set_nodelay(true);

                active.fetch_add(1, Ordering::Relaxed);
                let mgr = manager.clone();
                let counter = active.clone();
                let listener_mode = mode.clone();
                let prefix = name_prefix.clone();

                #[cfg(feature = "tls")]
                let tls = tls.clone();

                tokio::spawn(async move {
                    // Mode=Raw: skip auto-detect, go straight to raw handling
                    if listener_mode == ListenerMode::Raw {
                        debug!("listener mode=raw, handling {peer} as raw session");
                        mgr.handle_raw_connection(stream, peer, prefix).await;
                        counter.fetch_sub(1, Ordering::Relaxed);
                        return;
                    }

                    // Auto-detect: peek at first bytes to determine protocol.
                    // With TLS enabled, native agents start with a TLS ClientHello (0x16).
                    // Without TLS, native agents start with PKRL magic (0x504B524C).
                    // Raw shells send a prompt, banner, or nothing (timeout).
                    let mut peek_buf = [0u8; 4];
                    let is_native = if tls_enabled {
                        match tokio::time::timeout(
                            Duration::from_millis(500),
                            stream.peek(&mut peek_buf),
                        )
                        .await
                        {
                            Ok(Ok(n)) if n >= 1 => peek_buf[0] == 0x16,
                            _ => false,
                        }
                    } else {
                        match tokio::time::timeout(
                            Duration::from_millis(500),
                            stream.peek(&mut peek_buf),
                        )
                        .await
                        {
                            Ok(Ok(n)) if n >= 4 => {
                                u32::from_be_bytes(peek_buf) == PKRL_MAGIC
                            }
                            _ => false,
                        }
                    };

                    if is_native {
                        debug!("detected native PKRL connection from {peer}");

                        #[cfg(feature = "tls")]
                        let boxed: BoxedStream = if let Some(ref tls_cfg) = tls {
                            match tls_cfg.acceptor.accept(stream).await {
                                Ok(tls_stream) => BoxedStream::Tls(tls_stream),
                                Err(e) => {
                                    warn!("TLS handshake failed for {peer}: {e}");
                                    counter.fetch_sub(1, Ordering::Relaxed);
                                    return;
                                }
                            }
                        } else {
                            BoxedStream::Tcp(stream)
                        };

                        #[cfg(not(feature = "tls"))]
                        let boxed: BoxedStream = BoxedStream::Tcp(stream);

                        mgr.handle_connection(boxed, peer).await;
                    } else {
                        debug!("detected raw TCP connection from {peer}");
                        mgr.handle_raw_connection(stream, peer, prefix).await;
                    }

                    counter.fetch_sub(1, Ordering::Relaxed);
                });
            }
            Err(e) => {
                warn!("accept error: {e}");
            }
        }
    }
}

/// Generate a short hex ID from a UUID v4 (first 8 hex chars).
fn short_uuid() -> String {
    let id = uuid::Uuid::new_v4();
    id.simple().to_string()[..8].to_string()
}

#[cfg(feature = "tls")]
pub fn load_tls_config(
    cert_path: &str,
    key_path: &str,
) -> Result<TlsConfig, Box<dyn std::error::Error>> {
    use rustls::ServerConfig;
    use rustls_pemfile::{certs, private_key};
    use std::fs::File;
    use std::io::BufReader;

    let cert_file = File::open(cert_path)?;
    let key_file = File::open(key_path)?;

    let certs: Vec<_> = certs(&mut BufReader::new(cert_file)).collect::<Result<_, _>>()?;
    let key =
        private_key(&mut BufReader::new(key_file))?.ok_or("no private key found in key file")?;

    let config = ServerConfig::builder()
        .with_no_client_auth()
        .with_single_cert(certs, key)?;

    Ok(TlsConfig {
        acceptor: tokio_rustls::TlsAcceptor::from(Arc::new(config)),
    })
}

#[cfg(feature = "tls")]
pub fn generate_self_signed_tls() -> Result<TlsConfig, Box<dyn std::error::Error>> {
    use rustls::ServerConfig;

    let cert = rcgen::generate_simple_self_signed(vec!["gleipnir".to_string()])?;
    let cert_der = rustls::pki_types::CertificateDer::from(cert.cert.der().to_vec());
    let key_der =
        rustls::pki_types::PrivateKeyDer::try_from(cert.key_pair.serialize_der()).unwrap();

    let config = ServerConfig::builder()
        .with_no_client_auth()
        .with_single_cert(vec![cert_der], key_der)?;

    Ok(TlsConfig {
        acceptor: tokio_rustls::TlsAcceptor::from(Arc::new(config)),
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_listener_mode_from_str() {
        assert_eq!(ListenerMode::from_str("agent").unwrap(), ListenerMode::Agent);
        assert_eq!(ListenerMode::from_str("raw").unwrap(), ListenerMode::Raw);
        assert_eq!(ListenerMode::from_str("http").unwrap(), ListenerMode::Http);
        assert!(ListenerMode::from_str("bogus").is_err());
    }

    #[test]
    fn test_short_uuid_length() {
        let id = short_uuid();
        assert_eq!(id.len(), 8);
        assert!(id.chars().all(|c| c.is_ascii_hexdigit()));
    }

    #[tokio::test]
    async fn test_listener_manager_create_and_list() {
        #[cfg(feature = "tls")]
        rustls::crypto::ring::default_provider()
            .install_default()
            .ok();

        let sm = Arc::new(SessionManager::new());
        let lm = ListenerManager::new(
            sm,
            #[cfg(feature = "tls")]
            None,
        );

        // Port 0 = OS picks a free port
        let info = lm
            .create(0, ListenerMode::Agent, "127.0.0.1".into(), "".into())
            .await
            .expect("create listener");

        assert!(info.id.starts_with("lst-"));
        assert!(info.port > 0);
        assert_eq!(info.mode, "agent");
        assert_eq!(info.status, "running");

        let all = lm.list().await;
        assert_eq!(all.len(), 1);

        let got = lm.get(&info.id).await.expect("get listener");
        assert_eq!(got.port, info.port);

        lm.close(&info.id).await.expect("close listener");
        assert!(lm.list().await.is_empty());
    }

    #[tokio::test]
    async fn test_listener_manager_close_nonexistent() {
        let sm = Arc::new(SessionManager::new());
        let lm = ListenerManager::new(
            sm,
            #[cfg(feature = "tls")]
            None,
        );

        let result = lm.close("lst-nonexistent").await;
        assert!(result.is_err());
    }

    #[tokio::test]
    async fn test_listener_manager_duplicate_port() {
        #[cfg(feature = "tls")]
        rustls::crypto::ring::default_provider()
            .install_default()
            .ok();

        let sm = Arc::new(SessionManager::new());
        let lm = ListenerManager::new(
            sm,
            #[cfg(feature = "tls")]
            None,
        );

        let info = lm
            .create(0, ListenerMode::Agent, "127.0.0.1".into(), "".into())
            .await
            .expect("create first");

        // Binding the same port again should fail
        let result = lm
            .create(info.port, ListenerMode::Agent, "127.0.0.1".into(), "".into())
            .await;
        assert!(result.is_err());

        lm.close(&info.id).await.ok();
    }
}
