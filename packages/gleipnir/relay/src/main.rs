mod api;
mod listener;
mod protocol;
mod session;
mod socks;

use clap::Parser;
use std::sync::Arc;
use tracing::info;

use session::SessionManager;
use socks::SocksRelay;

#[derive(Parser)]
#[command(name = "gleipnir-relay", about = "Gleipnir reverse shell relay")]
struct Cli {
    #[arg(long, default_value = "0.0.0.0")]
    listen: String,

    #[arg(short, long, default_value_t = 4444)]
    port: u16,

    #[arg(long, default_value = "/tmp/gleipnir.sock")]
    api_socket: String,

    /// TLS certificate file (PEM). Enables TLS when both --tls-cert and --tls-key are set.
    #[cfg(feature = "tls")]
    #[arg(long)]
    tls_cert: Option<String>,

    /// TLS private key file (PEM)
    #[cfg(feature = "tls")]
    #[arg(long)]
    tls_key: Option<String>,
}

#[tokio::main]
async fn main() {
    tracing_subscriber::fmt()
        .with_env_filter(
            tracing_subscriber::EnvFilter::try_from_default_env()
                .unwrap_or_else(|_| "gleipnir_relay=info".into()),
        )
        .init();

    let cli = Cli::parse();
    let manager = Arc::new(SessionManager::new());
    let socks_relay = Arc::new(SocksRelay::new());

    info!("gleipnir relay starting");

    let api_manager = manager.clone();
    let api_socks = socks_relay.clone();
    let api_socket = cli.api_socket.clone();
    tokio::spawn(async move {
        api::start(&api_socket, api_manager, api_socks).await;
    });

    #[cfg(feature = "tls")]
    let tls_config = match (&cli.tls_cert, &cli.tls_key) {
        (Some(cert), Some(key)) => {
            let cfg = listener::load_tls_config(cert, key)
                .unwrap_or_else(|e| panic!("failed to load TLS config: {e}"));
            info!("TLS enabled (cert: {cert})");
            Some(cfg)
        }
        (Some(_), None) | (None, Some(_)) => {
            panic!("both --tls-cert and --tls-key must be provided");
        }
        _ => None,
    };

    listener::start(
        &cli.listen,
        cli.port,
        manager,
        #[cfg(feature = "tls")]
        tls_config,
    )
    .await;
}
