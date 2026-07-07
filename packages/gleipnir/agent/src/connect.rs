use std::time::Duration;
use tokio::net::TcpStream;
use tokio_util::codec::Framed;
use tracing::{info, warn};

use crate::protocol::GleipnirCodec;

pub struct ConnectConfig {
    pub hosts: Vec<String>,
    pub port: u16,
    pub max_retry_interval: u64,
}

pub async fn connect_loop(
    config: &ConnectConfig,
    mut on_connected: impl FnMut(Framed<TcpStream, GleipnirCodec>) -> tokio::task::JoinHandle<()>,
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

                let framed = Framed::new(stream, GleipnirCodec);
                let handle = on_connected(framed);
                let _ = handle.await;
                warn!("session ended, will reconnect");
            }
            Err(e) => {
                warn!("connection to {addr} failed: {e}");
                // Try next host on failure
                host_idx += 1;
            }
        }

        info!("reconnecting in {interval_secs}s");
        tokio::time::sleep(Duration::from_secs(interval_secs)).await;
        interval_secs = (interval_secs * 2).min(config.max_retry_interval);
    }
}
