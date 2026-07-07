use std::pin::Pin;
use std::task::{Context, Poll};
use std::time::Duration;
use tokio::io::{AsyncRead, AsyncWrite, ReadBuf};
use tokio::net::TcpStream;
use tokio_util::codec::Framed;
use tracing::{info, warn};

use crate::protocol::GleipnirCodec;

pub enum BoxedStream {
    Tcp(TcpStream),
    #[cfg(feature = "tls")]
    Tls(tokio_rustls::client::TlsStream<TcpStream>),
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

pub struct ConnectConfig {
    pub hosts: Vec<String>,
    pub port: u16,
    pub max_retry_interval: u64,
    #[cfg(feature = "tls")]
    pub tls: Option<TlsConfig>,
}

#[cfg(feature = "tls")]
pub struct TlsConfig {
    pub connector: tokio_rustls::TlsConnector,
    pub server_name: rustls::pki_types::ServerName<'static>,
}

pub async fn connect_loop(
    config: &ConnectConfig,
    mut on_connected: impl FnMut(Framed<BoxedStream, GleipnirCodec>) -> tokio::task::JoinHandle<()>,
) {
    let mut interval_secs = 1u64;
    let mut host_idx = 0usize;

    loop {
        let host = &config.hosts[host_idx % config.hosts.len()];
        let addr = format!("{host}:{}", config.port);
        info!("connecting to {addr}");

        match TcpStream::connect(&addr).await {
            Ok(stream) => {
                info!("connected to {addr}");
                interval_secs = 1;

                let boxed = wrap_stream(
                    stream,
                    #[cfg(feature = "tls")]
                    &config.tls,
                )
                .await;

                match boxed {
                    Some(s) => {
                        let framed = Framed::new(s, GleipnirCodec);
                        let handle = on_connected(framed);
                        let _ = handle.await;
                        warn!("session ended, will reconnect");
                    }
                    None => {
                        warn!("stream setup failed, will retry");
                    }
                }
            }
            Err(e) => {
                warn!("connection to {addr} failed: {e}");
                host_idx += 1;
            }
        }

        info!("reconnecting in {interval_secs}s");
        tokio::time::sleep(Duration::from_secs(interval_secs)).await;
        interval_secs = (interval_secs * 2).min(config.max_retry_interval);
    }
}

async fn wrap_stream(
    stream: TcpStream,
    #[cfg(feature = "tls")] tls: &Option<TlsConfig>,
) -> Option<BoxedStream> {
    #[cfg(feature = "tls")]
    if let Some(tls_cfg) = tls {
        return match tls_cfg
            .connector
            .connect(tls_cfg.server_name.clone(), stream)
            .await
        {
            Ok(tls_stream) => {
                info!("TLS handshake completed");
                Some(BoxedStream::Tls(tls_stream))
            }
            Err(e) => {
                warn!("TLS handshake failed: {e}");
                None
            }
        };
    }
    Some(BoxedStream::Tcp(stream))
}

#[cfg(feature = "tls")]
pub fn build_tls_config(ca_path: Option<&str>) -> TlsConfig {
    use rustls::ClientConfig;
    use std::sync::Arc;

    let config = if let Some(ca) = ca_path {
        let cert_file = std::fs::File::open(ca).expect("failed to open CA cert file");
        let mut reader = std::io::BufReader::new(cert_file);
        let mut root_store = rustls::RootCertStore::empty();
        for cert in rustls_pemfile::certs(&mut reader) {
            root_store.add(cert.expect("invalid cert in CA file")).ok();
        }
        ClientConfig::builder()
            .with_root_certificates(root_store)
            .with_no_client_auth()
    } else {
        // Dangerous: accept any certificate (for self-signed certs in CTF environments)
        let verifier = Arc::new(DangerousVerifier);
        ClientConfig::builder()
            .dangerous()
            .with_custom_certificate_verifier(verifier)
            .with_no_client_auth()
    };

    TlsConfig {
        connector: tokio_rustls::TlsConnector::from(Arc::new(config)),
        server_name: rustls::pki_types::ServerName::try_from("gleipnir")
            .expect("valid server name")
            .to_owned(),
    }
}

#[cfg(feature = "tls")]
#[derive(Debug)]
struct DangerousVerifier;

#[cfg(feature = "tls")]
impl rustls::client::danger::ServerCertVerifier for DangerousVerifier {
    fn verify_server_cert(
        &self,
        _end_entity: &rustls::pki_types::CertificateDer<'_>,
        _intermediates: &[rustls::pki_types::CertificateDer<'_>],
        _server_name: &rustls::pki_types::ServerName<'_>,
        _ocsp_response: &[u8],
        _now: rustls::pki_types::UnixTime,
    ) -> Result<rustls::client::danger::ServerCertVerified, rustls::Error> {
        Ok(rustls::client::danger::ServerCertVerified::assertion())
    }

    fn verify_tls12_signature(
        &self,
        _message: &[u8],
        _cert: &rustls::pki_types::CertificateDer<'_>,
        _dss: &rustls::DigitallySignedStruct,
    ) -> Result<rustls::client::danger::HandshakeSignatureValid, rustls::Error> {
        Ok(rustls::client::danger::HandshakeSignatureValid::assertion())
    }

    fn verify_tls13_signature(
        &self,
        _message: &[u8],
        _cert: &rustls::pki_types::CertificateDer<'_>,
        _dss: &rustls::DigitallySignedStruct,
    ) -> Result<rustls::client::danger::HandshakeSignatureValid, rustls::Error> {
        Ok(rustls::client::danger::HandshakeSignatureValid::assertion())
    }

    fn supported_verify_schemes(&self) -> Vec<rustls::SignatureScheme> {
        rustls::crypto::ring::default_provider()
            .signature_verification_algorithms
            .supported_schemes()
    }
}
