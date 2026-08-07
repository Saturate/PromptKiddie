use std::time::Duration;
use tokio::net::TcpListener;
use tokio_util::codec::Framed;
use tracing::{info, warn};

use crate::connect::BoxedStream;
use crate::protocol::GleipnirCodec;

pub struct BindConfig {
    pub addr: String,
    pub port: u16,
    #[cfg(feature = "tls")]
    pub tls: Option<BindTlsConfig>,
}

#[cfg(feature = "tls")]
pub struct BindTlsConfig {
    pub acceptor: tokio_rustls::TlsAcceptor,
}

pub async fn bind_loop(
    config: &BindConfig,
    mut on_connected: impl FnMut(Framed<BoxedStream, GleipnirCodec>) -> tokio::task::JoinHandle<()>,
) {
    let addr = format!("{}:{}", config.addr, config.port);
    let listener = TcpListener::bind(&addr)
        .await
        .unwrap_or_else(|e| panic!("failed to bind {addr}: {e}"));

    info!("listening on {addr} (bind mode)");

    loop {
        match listener.accept().await {
            Ok((stream, peer)) => {
                info!("incoming connection from {peer}");
                let _ = stream.set_nodelay(true);

                #[cfg(feature = "tls")]
                let boxed: BoxedStream = if let Some(ref tls_cfg) = config.tls {
                    match tls_cfg.acceptor.accept(stream).await {
                        Ok(tls_stream) => {
                            info!("TLS handshake completed with {peer}");
                            BoxedStream::TlsServer(tls_stream)
                        }
                        Err(e) => {
                            warn!("TLS handshake failed for {peer}: {e}");
                            continue;
                        }
                    }
                } else {
                    BoxedStream::Tcp(stream)
                };

                #[cfg(not(feature = "tls"))]
                let boxed: BoxedStream = BoxedStream::Tcp(stream);

                let framed = Framed::new(boxed, GleipnirCodec);
                let handle = on_connected(framed);
                let _ = handle.await;
                info!("session ended, waiting for next connection");
            }
            Err(e) => {
                warn!("accept error: {e}");
                tokio::time::sleep(Duration::from_secs(1)).await;
            }
        }
    }
}

#[cfg(feature = "tls")]
pub fn generate_self_signed_tls() -> BindTlsConfig {
    use rustls::ServerConfig;
    use std::sync::Arc;

    let cert = rcgen::generate_simple_self_signed(vec!["gleipnir".to_string()])
        .expect("generate self-signed cert");
    let cert_der = rustls::pki_types::CertificateDer::from(cert.cert.der().to_vec());
    let key_der =
        rustls::pki_types::PrivateKeyDer::try_from(cert.key_pair.serialize_der()).unwrap();

    let config = ServerConfig::builder()
        .with_no_client_auth()
        .with_single_cert(vec![cert_der], key_der)
        .expect("build server TLS config");

    BindTlsConfig {
        acceptor: tokio_rustls::TlsAcceptor::from(Arc::new(config)),
    }
}
