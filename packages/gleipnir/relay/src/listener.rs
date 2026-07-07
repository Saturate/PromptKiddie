use std::sync::Arc;
use std::time::Duration;
use tokio::net::TcpListener;
use tracing::{info, warn};

use crate::session::SessionManager;

pub async fn start(listen: &str, port: u16, manager: Arc<SessionManager>) {
    let addr = format!("{listen}:{port}");
    let listener = TcpListener::bind(&addr)
        .await
        .unwrap_or_else(|e| panic!("failed to bind {addr}: {e}"));

    info!("listening on {addr}");

    loop {
        match listener.accept().await {
            Ok((stream, peer)) => {
                let sock_ref = socket2::SockRef::from(&stream);
                let keepalive = socket2::TcpKeepalive::new()
                    .with_time(Duration::from_secs(5))
                    .with_interval(Duration::from_secs(2));
                if let Err(e) = sock_ref.set_tcp_keepalive(&keepalive) {
                    warn!("failed to set TCP keepalive for {peer}: {e}");
                }
                let _ = stream.set_nodelay(true);

                let mgr = manager.clone();
                tokio::spawn(async move {
                    mgr.handle_connection(stream, peer).await;
                });
            }
            Err(e) => {
                warn!("accept error: {e}");
            }
        }
    }
}
