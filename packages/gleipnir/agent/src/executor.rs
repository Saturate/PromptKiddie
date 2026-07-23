use std::path::PathBuf;
use std::sync::Arc;
use tokio::process::Command;
use tokio::sync::Mutex;
use tracing::{debug, warn};

pub struct Executor {
    cwd: Arc<Mutex<PathBuf>>,
}

impl Executor {
    pub fn new() -> Self {
        let cwd = std::env::current_dir().unwrap_or_else(|_| PathBuf::from("/"));
        Self {
            cwd: Arc::new(Mutex::new(cwd)),
        }
    }

    pub async fn execute(&self, command: &str, timeout_secs: u64) -> ExecutionResult {
        let cwd = self.cwd.lock().await.clone();
        debug!("executing in {}: {command}", cwd.display());

        let (shell, flag) = shell_for_platform();

        let mut child = match Command::new(shell)
            .arg(flag)
            .arg(command)
            .current_dir(&cwd)
            .stdout(std::process::Stdio::piped())
            .stderr(std::process::Stdio::piped())
            .kill_on_drop(true)
            .spawn()
        {
            Ok(c) => c,
            Err(e) => {
                return ExecutionResult {
                    output: format!("exec error: {e}").into_bytes(),
                };
            }
        };

        // Take stdout/stderr handles so we can read them after wait
        let stdout = child.stdout.take();
        let stderr = child.stderr.take();

        let result =
            tokio::time::timeout(std::time::Duration::from_secs(timeout_secs), child.wait()).await;

        match result {
            Ok(Ok(_status)) => {
                use tokio::io::AsyncReadExt;
                let mut combined = Vec::new();
                if let Some(mut out) = stdout {
                    let _ = out.read_to_end(&mut combined).await;
                }
                if let Some(mut err) = stderr {
                    let mut err_buf = Vec::new();
                    let _ = err.read_to_end(&mut err_buf).await;
                    if !err_buf.is_empty() {
                        if !combined.is_empty() {
                            combined.push(b'\n');
                        }
                        combined.extend_from_slice(&err_buf);
                    }
                }

                self.maybe_update_cwd(command).await;

                ExecutionResult { output: combined }
            }
            Ok(Err(e)) => ExecutionResult {
                output: format!("exec error: {e}").into_bytes(),
            },
            Err(_) => {
                warn!("command timed out after {timeout_secs}s: {command}");
                let _ = child.kill().await;
                ExecutionResult {
                    output: format!("timed out after {timeout_secs}s").into_bytes(),
                }
            }
        }
    }

    async fn maybe_update_cwd(&self, command: &str) {
        let trimmed = command.trim();
        let cd_arg = trimmed.strip_prefix("cd ").map(str::trim);

        if let Some(dir) = cd_arg {
            let mut cwd = self.cwd.lock().await;
            let new_path = if PathBuf::from(dir).is_absolute() {
                PathBuf::from(dir)
            } else {
                cwd.join(dir)
            };

            if let Ok(canonical) = tokio::fs::canonicalize(&new_path).await {
                *cwd = canonical;
            }
        }
    }
}

pub struct ExecutionResult {
    pub output: Vec<u8>,
}

fn shell_for_platform() -> (&'static str, &'static str) {
    if cfg!(windows) {
        ("cmd.exe", "/c")
    } else {
        ("/bin/sh", "-c")
    }
}
