use std::sync::Arc;
use std::sync::atomic::{AtomicUsize, Ordering};
use std::time::Duration;
use tokio::net::TcpListener;
use tracing::{info, warn};

use crate::session::{BoxedStream, SessionManager};

const MAX_CONNECTIONS: usize = 64;

#[cfg(feature = "tls")]
pub struct TlsConfig {
    pub acceptor: tokio_rustls::TlsAcceptor,
}

pub async fn start(
    listen: &str,
    port: u16,
    manager: Arc<SessionManager>,
    #[cfg(feature = "tls")] tls: Option<TlsConfig>,
) {
    let addr = format!("{listen}:{port}");
    let listener = TcpListener::bind(&addr)
        .await
        .unwrap_or_else(|e| panic!("failed to bind {addr}: {e}"));

    let active = Arc::new(AtomicUsize::new(0));

    #[cfg(feature = "tls")]
    let tls_label = if tls.is_some() { " (TLS)" } else { "" };
    #[cfg(not(feature = "tls"))]
    let tls_label = "";

    info!("listening on {addr}{tls_label} (max {MAX_CONNECTIONS} connections)");

    #[cfg(feature = "tls")]
    let tls = tls.map(Arc::new);

    loop {
        match listener.accept().await {
            Ok((stream, peer)) => {
                let current = active.load(Ordering::Relaxed);
                if current >= MAX_CONNECTIONS {
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

                #[cfg(feature = "tls")]
                let tls = tls.clone();

                tokio::spawn(async move {
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
                    counter.fetch_sub(1, Ordering::Relaxed);
                });
            }
            Err(e) => {
                warn!("accept error: {e}");
            }
        }
    }
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
