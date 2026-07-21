use axum::extract::ws::{Message, WebSocket};
use axum::extract::{Path, State, WebSocketUpgrade};
use axum::response::IntoResponse;
use serde::Serialize;
use std::sync::Arc;
use tokio::sync::broadcast;
use tracing::debug;

use crate::http_api::AppState;

#[derive(Clone, Debug, Serialize)]
pub struct SessionEvent {
    pub event: String,
    #[serde(flatten)]
    pub data: serde_json::Value,
}

impl SessionEvent {
    pub fn new_session(name: &str, mode: &str, target: &str) -> Self {
        Self {
            event: "session.new".into(),
            data: serde_json::json!({ "session": name, "mode": mode, "target": target }),
        }
    }

    pub fn session_closed(name: &str, reason: &str) -> Self {
        Self {
            event: "session.closed".into(),
            data: serde_json::json!({ "session": name, "reason": reason }),
        }
    }

    pub fn listener_connection(listener_id: &str, from: &str) -> Self {
        Self {
            event: "listener.connection".into(),
            data: serde_json::json!({ "listener": listener_id, "from": from }),
        }
    }
}

#[derive(Clone)]
pub struct EventBus {
    tx: broadcast::Sender<SessionEvent>,
}

impl EventBus {
    pub fn new() -> Self {
        let (tx, _) = broadcast::channel(256);
        Self { tx }
    }

    pub fn emit(&self, event: SessionEvent) {
        let _ = self.tx.send(event);
    }

    pub fn subscribe(&self) -> broadcast::Receiver<SessionEvent> {
        self.tx.subscribe()
    }
}

pub async fn ws_events(
    ws: WebSocketUpgrade,
    State(state): State<AppState>,
) -> impl IntoResponse {
    ws.on_upgrade(move |socket| handle_events(socket, state.event_bus.clone()))
}

async fn handle_events(mut socket: WebSocket, bus: Arc<EventBus>) {
    let mut rx = bus.subscribe();
    loop {
        tokio::select! {
            event = rx.recv() => {
                match event {
                    Ok(ev) => {
                        let json = serde_json::to_string(&ev).unwrap_or_default();
                        if socket.send(Message::Text(json.into())).await.is_err() {
                            break;
                        }
                    }
                    Err(broadcast::error::RecvError::Lagged(n)) => {
                        debug!("ws events client lagged by {n} events");
                    }
                    Err(_) => break,
                }
            }
            msg = socket.recv() => {
                match msg {
                    Some(Ok(Message::Close(_))) | None => break,
                    _ => {}
                }
            }
        }
    }
}

pub async fn ws_attach(
    ws: WebSocketUpgrade,
    State(state): State<AppState>,
    Path(name): Path<String>,
) -> impl IntoResponse {
    ws.on_upgrade(move |socket| handle_attach(socket, state, name))
}

async fn handle_attach(mut socket: WebSocket, state: AppState, name: String) {
    let cmd_tx = {
        let sessions = state.manager.sessions_ref().lock().await;
        match sessions.get(&name) {
            Some(s) if s.info.connected => Some(s.cmd_tx.clone()),
            _ => None,
        }
    };

    let Some(_cmd_tx) = cmd_tx else {
        let _ = socket
            .send(Message::Text(
                format!("{{\"error\":\"session '{name}' not found or not connected\"}}").into(),
            ))
            .await;
        return;
    };

    // For interactive attach, we use exec with short timeout per keystroke batch.
    // A full PTY relay would require the session_raw stream to be split, which is
    // a larger refactor. For now, we relay via exec commands.
    while let Some(Ok(msg)) = socket.recv().await {
        match msg {
            Message::Text(text) => {
                let cmd = text.to_string();
                if cmd.is_empty() {
                    continue;
                }
                match state.manager.exec(&name, &cmd, 10).await {
                    Ok(output) => {
                        let text = String::from_utf8_lossy(&output).to_string();
                        if socket.send(Message::Text(text.into())).await.is_err() {
                            break;
                        }
                    }
                    Err(e) => {
                        if socket
                            .send(Message::Text(format!("{{\"error\":\"{e}\"}}").into()))
                            .await
                            .is_err()
                        {
                            break;
                        }
                    }
                }
            }
            Message::Close(_) => break,
            _ => {}
        }
    }
}
