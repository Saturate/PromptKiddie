use serde::Serialize;
use std::path::Path;

#[derive(Debug, Clone, Serialize)]
pub struct PlatformInfo {
    pub os: String,
    pub arch: String,
    pub hostname: String,
    pub username: String,
    pub pid: u32,
    pub cwd: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub session_id: Option<String>,
}

impl PlatformInfo {
    pub fn detect() -> Self {
        Self {
            os: std::env::consts::OS.to_string(),
            arch: std::env::consts::ARCH.to_string(),
            hostname: hostname(),
            username: username(),
            pid: std::process::id(),
            cwd: std::env::current_dir()
                .map(|p| p.to_string_lossy().to_string())
                .unwrap_or_default(),
            session_id: None,
        }
    }

    pub fn with_session_id(mut self, id: Option<String>) -> Self {
        self.session_id = id;
        self
    }

    pub fn to_json_bytes(&self) -> Vec<u8> {
        serde_json::to_vec(self).unwrap_or_default()
    }
}

const SESSION_ID_FILE: &str = "/tmp/.gleipnir-sid";

pub fn resolve_session_id(explicit: Option<String>) -> String {
    if let Some(id) = explicit {
        return id;
    }

    if let Ok(id) = std::fs::read_to_string(SESSION_ID_FILE) {
        let id = id.trim().to_string();
        if !id.is_empty() {
            return id;
        }
    }

    let id = format!("{:016x}", rand_id());
    let _ = std::fs::write(SESSION_ID_FILE, &id);
    id
}

fn rand_id() -> u64 {
    // Lightweight random: mix pid, time, and pointer address
    let pid = std::process::id() as u64;
    let ptr = &pid as *const u64 as u64;
    let time = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_nanos() as u64)
        .unwrap_or(0);
    pid.wrapping_mul(6364136223846793005) ^ time.wrapping_mul(1442695040888963407) ^ ptr
}

pub fn session_id_path() -> &'static Path {
    Path::new(SESSION_ID_FILE)
}

fn hostname() -> String {
    #[cfg(unix)]
    {
        let mut buf = [0u8; 256];
        unsafe {
            if libc::gethostname(buf.as_mut_ptr() as *mut _, buf.len()) == 0 {
                let len = buf.iter().position(|&b| b == 0).unwrap_or(buf.len());
                return String::from_utf8_lossy(&buf[..len]).to_string();
            }
        }
    }
    std::env::var("COMPUTERNAME")
        .or_else(|_| std::env::var("HOSTNAME"))
        .unwrap_or_else(|_| "unknown".into())
}

fn username() -> String {
    #[cfg(unix)]
    {
        if let Ok(user) = std::env::var("USER") {
            return user;
        }
    }
    #[cfg(windows)]
    {
        if let Ok(user) = std::env::var("USERNAME") {
            return user;
        }
    }
    "unknown".into()
}
