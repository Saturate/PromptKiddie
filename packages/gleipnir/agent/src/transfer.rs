use std::path::Path;
use tokio::fs;
use tracing::{debug, warn};

pub async fn handle_file_up_data(remote_path: &str, data: &[u8]) -> Result<String, String> {
    debug!("writing {} bytes to {remote_path}", data.len());

    let path = Path::new(remote_path);
    if let Some(parent) = path.parent()
        && !parent.exists()
    {
        fs::create_dir_all(parent)
            .await
            .map_err(|e| format!("mkdir failed: {e}"))?;
    }

    let tmp_path = format!("{remote_path}.pkltmp");
    fs::write(&tmp_path, data)
        .await
        .map_err(|e| format!("write failed: {e}"))?;

    if let Err(e) = fs::rename(&tmp_path, remote_path).await {
        warn!("rename failed ({e}), falling back to direct write");
        fs::write(remote_path, data)
            .await
            .map_err(|e2| format!("direct write also failed: {e2}"))?;
        let _ = fs::remove_file(&tmp_path).await;
    }

    Ok(format!("ok: {} bytes written to {remote_path}", data.len()))
}

pub async fn handle_file_down(remote_path: &str) -> Result<Vec<u8>, String> {
    debug!("reading file {remote_path}");
    fs::read(remote_path)
        .await
        .map_err(|e| format!("read {remote_path}: {e}"))
}
