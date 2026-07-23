use serde::{Deserialize, Serialize};
use std::sync::Arc;
use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader};
use tokio::net::UnixListener;
use tracing::{debug, info, warn};

use crate::session::SessionManager;
use crate::socks::SocksRelay;

#[derive(Debug, Deserialize)]
#[serde(tag = "action", rename_all = "lowercase")]
enum ApiRequest {
    Exec {
        session: String,
        command: String,
        #[serde(default = "default_timeout")]
        timeout: u64,
    },
    Upload {
        session: String,
        src: String,
        dst: String,
    },
    Download {
        session: String,
        src: String,
        dst: String,
    },
    Socks {
        session: String,
        port: u16,
        #[serde(default)]
        stop: bool,
    },
    Tunnels,
    Sessions,
    Session {
        name: String,
    },
}

fn default_timeout() -> u64 {
    300
}

#[derive(Debug, Serialize)]
struct ApiResponse {
    ok: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    data: Option<serde_json::Value>,
    #[serde(skip_serializing_if = "Option::is_none")]
    error: Option<String>,
}

impl ApiResponse {
    fn success(data: serde_json::Value) -> Self {
        Self {
            ok: true,
            data: Some(data),
            error: None,
        }
    }

    fn error(msg: String) -> Self {
        Self {
            ok: false,
            data: None,
            error: Some(msg),
        }
    }
}

pub async fn start(socket_path: &str, manager: Arc<SessionManager>, socks_relay: Arc<SocksRelay>) {
    let _ = tokio::fs::remove_file(socket_path).await;

    let listener = UnixListener::bind(socket_path)
        .unwrap_or_else(|e| panic!("failed to bind unix socket {socket_path}: {e}"));

    info!("API listening on {socket_path}");

    loop {
        match listener.accept().await {
            Ok((stream, _)) => {
                let mgr = manager.clone();
                let sr = socks_relay.clone();
                tokio::spawn(async move {
                    handle_client(stream, mgr, sr).await;
                });
            }
            Err(e) => {
                warn!("API accept error: {e}");
            }
        }
    }
}

async fn handle_client(
    stream: tokio::net::UnixStream,
    manager: Arc<SessionManager>,
    socks_relay: Arc<SocksRelay>,
) {
    let (reader, mut writer) = stream.into_split();
    let mut lines = BufReader::new(reader).lines();

    while let Ok(Some(line)) = lines.next_line().await {
        debug!("API request: {line}");
        let response = match serde_json::from_str::<ApiRequest>(&line) {
            Ok(req) => handle_request(req, &manager, &socks_relay).await,
            Err(e) => ApiResponse::error(format!("invalid request: {e}")),
        };

        let mut json = serde_json::to_string(&response).unwrap_or_else(|_| "{}".into());
        json.push('\n');
        if writer.write_all(json.as_bytes()).await.is_err() {
            break;
        }
    }
}

async fn handle_request(
    req: ApiRequest,
    manager: &SessionManager,
    socks_relay: &SocksRelay,
) -> ApiResponse {
    match req {
        ApiRequest::Exec {
            session,
            command,
            timeout,
        } => match manager.exec(&session, &command, timeout).await {
            Ok(output) => {
                if output.contains(&0) || std::str::from_utf8(&output).is_err() {
                    use base64::Engine;
                    let b64 = base64::engine::general_purpose::STANDARD.encode(&output);
                    ApiResponse::success(
                        serde_json::json!({ "output_b64": b64, "encoding": "base64" }),
                    )
                } else {
                    let text = String::from_utf8_lossy(&output).to_string();
                    ApiResponse::success(serde_json::json!({ "output": text }))
                }
            }
            Err(e) => ApiResponse::error(e),
        },

        ApiRequest::Upload { session, src, dst } => {
            if manager
                .get_session(&session)
                .await
                .is_some_and(|i| i.mode == "raw")
            {
                return ApiResponse::error(
                    "file upload not supported for raw sessions".to_string(),
                );
            }
            if !src.starts_with("/tmp/") && !src.starts_with("/workspace/") {
                return ApiResponse::error(
                    "src path restricted to /tmp/ and /workspace/".to_string(),
                );
            }
            match tokio::fs::read(&src).await {
                Ok(data) => {
                    let size = data.len();
                    let start = std::time::Instant::now();
                    match manager.upload(&session, data, &dst).await {
                        Ok(()) => {
                            let elapsed_ms = start.elapsed().as_millis();
                            ApiResponse::success(serde_json::json!({
                                "uploaded": dst,
                                "size": size,
                                "elapsed_ms": elapsed_ms,
                            }))
                        }
                        Err(e) => ApiResponse::error(e),
                    }
                }
                Err(e) => ApiResponse::error(format!("failed to read {src}: {e}")),
            }
        }

        ApiRequest::Download { session, src, dst } => {
            match manager.download(&session, &src).await {
                Ok(data) => match tokio::fs::write(&dst, &data).await {
                    Ok(()) => ApiResponse::success(serde_json::json!({
                        "downloaded": src,
                        "saved_to": dst,
                        "size": data.len(),
                    })),
                    Err(e) => ApiResponse::error(format!("failed to write {dst}: {e}")),
                },
                Err(e) => ApiResponse::error(e),
            }
        }

        ApiRequest::Socks {
            session,
            port,
            stop,
        } => {
            if stop {
                match socks_relay.stop_tunnel(&session).await {
                    Ok(()) => ApiResponse::success(serde_json::json!({ "stopped": session })),
                    Err(e) => ApiResponse::error(e),
                }
            } else {
                let frame_tx = match manager.get_frame_sender(&session).await {
                    Ok(tx) => tx,
                    Err(e) => return ApiResponse::error(e),
                };
                let conns = match manager.get_socks_connections(&session).await {
                    Ok(c) => c,
                    Err(e) => return ApiResponse::error(e),
                };
                match socks_relay
                    .start_tunnel(&session, port, frame_tx, conns)
                    .await
                {
                    Ok(()) => ApiResponse::success(serde_json::json!({
                        "session": session,
                        "port": port,
                    })),
                    Err(e) => ApiResponse::error(e),
                }
            }
        }

        ApiRequest::Tunnels => {
            let tunnels = socks_relay.list_tunnels().await;
            let data: Vec<_> = tunnels
                .into_iter()
                .map(|(name, port)| serde_json::json!({"session": name, "port": port}))
                .collect();
            ApiResponse::success(serde_json::json!(data))
        }

        ApiRequest::Sessions => {
            let sessions = manager.list_sessions().await;
            ApiResponse::success(serde_json::to_value(sessions).unwrap_or_default())
        }

        ApiRequest::Session { name } => match manager.get_session(&name).await {
            Some(info) => ApiResponse::success(serde_json::to_value(info).unwrap_or_default()),
            None => ApiResponse::error(format!("session '{name}' not found")),
        },
    }
}
