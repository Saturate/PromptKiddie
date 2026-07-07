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

    listener::start(&cli.listen, cli.port, manager).await;
}
