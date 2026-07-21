use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::sync::Arc;
use std::time::{Duration, Instant};
use tokio::sync::{Mutex, oneshot};

const DEFAULT_POLL_TIMEOUT: u64 = 120;

#[derive(Debug)]
struct PendingTask {
    command: String,
    reply: oneshot::Sender<Result<Vec<u8>, String>>,
}

#[derive(Debug)]
pub struct HttpSession {
    pub name: String,
    pub target: String,
    pub last_checkin: Instant,
    pub poll_timeout: Duration,
    pending_task: Option<PendingTask>,
}

#[derive(Debug, Serialize)]
pub struct HttpSessionInfo {
    pub name: String,
    pub target: String,
    pub last_checkin_secs_ago: u64,
}

#[derive(Debug, Deserialize)]
pub struct CheckinRequest {
    #[serde(default)]
    pub hostname: String,
    #[serde(default)]
    pub username: String,
    #[serde(default)]
    pub os: String,
}

#[derive(Debug, Serialize)]
pub struct CheckinResponse {
    pub session: String,
    pub poll_interval: u64,
}

#[derive(Debug, Serialize)]
pub struct TaskResponse {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub command: Option<String>,
}

#[derive(Debug, Deserialize)]
pub struct ResultRequest {
    pub output: String,
}

pub struct HttpSessionManager {
    sessions: Arc<Mutex<HashMap<String, HttpSession>>>,
}

impl HttpSessionManager {
    pub fn new() -> Self {
        Self {
            sessions: Arc::new(Mutex::new(HashMap::new())),
        }
    }

    pub async fn checkin(
        &self,
        session_name: &str,
        target: &str,
        _req: &CheckinRequest,
    ) -> CheckinResponse {
        let mut sessions = self.sessions.lock().await;
        let entry = sessions
            .entry(session_name.to_string())
            .or_insert_with(|| HttpSession {
                name: session_name.to_string(),
                target: target.to_string(),
                last_checkin: Instant::now(),
                poll_timeout: Duration::from_secs(DEFAULT_POLL_TIMEOUT),
                pending_task: None,
            });
        entry.last_checkin = Instant::now();
        CheckinResponse {
            session: session_name.to_string(),
            poll_interval: 5,
        }
    }

    pub async fn get_task(&self, session_name: &str) -> Option<String> {
        let mut sessions = self.sessions.lock().await;
        let session = sessions.get_mut(session_name)?;
        session.last_checkin = Instant::now();
        session.pending_task.as_ref().map(|t| t.command.clone())
    }

    pub async fn submit_result(&self, session_name: &str, output: &str) -> Result<(), String> {
        let mut sessions = self.sessions.lock().await;
        let session = sessions
            .get_mut(session_name)
            .ok_or_else(|| format!("session '{session_name}' not found"))?;
        session.last_checkin = Instant::now();
        if let Some(task) = session.pending_task.take() {
            let _ = task.reply.send(Ok(output.as_bytes().to_vec()));
            Ok(())
        } else {
            Err("no pending task".into())
        }
    }

    pub async fn queue_exec(
        &self,
        session_name: &str,
        command: &str,
        reply: oneshot::Sender<Result<Vec<u8>, String>>,
    ) -> Result<(), String> {
        let mut sessions = self.sessions.lock().await;
        let session = sessions
            .get_mut(session_name)
            .ok_or_else(|| format!("session '{session_name}' not found"))?;
        if session.pending_task.is_some() {
            return Err("session already has a pending task".into());
        }
        session.pending_task = Some(PendingTask {
            command: command.to_string(),
            reply,
        });
        Ok(())
    }

    pub async fn list_sessions(&self) -> Vec<HttpSessionInfo> {
        let sessions = self.sessions.lock().await;
        sessions
            .values()
            .map(|s| HttpSessionInfo {
                name: s.name.clone(),
                target: s.target.clone(),
                last_checkin_secs_ago: s.last_checkin.elapsed().as_secs(),
            })
            .collect()
    }

    pub async fn store_exfil(&self, session_name: &str, _data: &[u8]) -> Result<(), String> {
        let sessions = self.sessions.lock().await;
        if sessions.contains_key(session_name) {
            // TODO: store to engagement evidence directory
            Ok(())
        } else {
            Err(format!("session '{session_name}' not found"))
        }
    }
}
