use bytes::BytesMut;
use std::path::Path;
use tokio::fs;
use tracing::{debug, warn};

pub struct FileUpRequest {
    pub remote_path: String,
    pub data: Vec<u8>,
}

impl FileUpRequest {
    pub fn parse(payload: &BytesMut) -> Option<Self> {
        if payload.len() < 4 {
            return None;
        }
        let path_len =
            u32::from_be_bytes([payload[0], payload[1], payload[2], payload[3]]) as usize;
        if payload.len() < 4 + path_len {
            return None;
        }
        let remote_path = String::from_utf8_lossy(&payload[4..4 + path_len]).to_string();
        let data = payload[4 + path_len..].to_vec();
        Some(Self { remote_path, data })
    }
}

pub async fn handle_file_up(payload: &BytesMut) -> Result<String, String> {
    let req =
        FileUpRequest::parse(payload).ok_or_else(|| "malformed file upload frame".to_string())?;

    debug!("writing {} bytes to {}", req.data.len(), req.remote_path);

    let path = Path::new(&req.remote_path);
    if let Some(parent) = path.parent()
        && !parent.exists()
    {
        fs::create_dir_all(parent)
            .await
            .map_err(|e| format!("mkdir failed: {e}"))?;
    }

    // Atomic write: temp file + rename
    let tmp_path = format!("{}.pkltmp", req.remote_path);
    fs::write(&tmp_path, &req.data)
        .await
        .map_err(|e| format!("write failed: {e}"))?;

    if let Err(e) = fs::rename(&tmp_path, &req.remote_path).await {
        warn!("rename failed ({e}), falling back to direct write");
        fs::write(&req.remote_path, &req.data)
            .await
            .map_err(|e2| format!("direct write also failed: {e2}"))?;
        let _ = fs::remove_file(&tmp_path).await;
    }

    Ok(format!(
        "ok: {} bytes written to {}",
        req.data.len(),
        req.remote_path
    ))
}

pub async fn handle_file_down(remote_path: &str) -> Result<Vec<u8>, String> {
    debug!("reading file {remote_path}");
    fs::read(remote_path)
        .await
        .map_err(|e| format!("read {remote_path}: {e}"))
}
