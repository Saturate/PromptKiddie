use std::time::Duration;
use tokio::io::{AsyncBufReadExt, AsyncReadExt, AsyncWriteExt, BufReader};
use tokio::net::UnixStream;
use tokio::process::Command;
use tokio::time::timeout;

const RELAY_PORT: u16 = 14444;
const API_SOCKET: &str = "/tmp/gleipnir-test.sock";
const STARTUP_WAIT: Duration = Duration::from_millis(500);
const CMD_TIMEOUT: Duration = Duration::from_secs(10);

async fn api_request(req: &str) -> serde_json::Value {
    let stream = UnixStream::connect(API_SOCKET)
        .await
        .expect("connect to API socket");
    let (reader, mut writer) = stream.into_split();

    let mut line = req.to_string();
    line.push('\n');
    writer
        .write_all(line.as_bytes())
        .await
        .expect("write request");

    let mut reader = BufReader::new(reader);
    let mut response = String::new();
    timeout(CMD_TIMEOUT, reader.read_line(&mut response))
        .await
        .expect("response timeout")
        .expect("read response");

    serde_json::from_str(&response).expect("parse JSON response")
}

struct TestHarness {
    relay: tokio::process::Child,
    agent: tokio::process::Child,
}

fn find_binary(name: &str) -> std::path::PathBuf {
    let target_dir = std::path::PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join("../target/debug")
        .canonicalize()
        .expect("find target/debug");
    let bin = target_dir.join(name);
    assert!(bin.exists(), "binary not found: {}", bin.display());
    bin
}

impl TestHarness {
    async fn start() -> Self {
        Self::start_with_args(&[], &[]).await
    }

    async fn start_with_args(relay_extra: &[&str], agent_extra: &[&str]) -> Self {
        let _ = tokio::fs::remove_file(API_SOCKET).await;

        let mut relay_args = vec![
            "--port".to_string(),
            RELAY_PORT.to_string(),
            "--api-socket".to_string(),
            API_SOCKET.to_string(),
            "--api-port".to_string(),
            "0".to_string(),
        ];
        #[cfg(feature = "tls")]
        relay_args.push("--no-tls".to_string());
        relay_args.extend(relay_extra.iter().map(|s| s.to_string()));

        let relay = Command::new(find_binary("gleipnir-server"))
            .args(&relay_args)
            .kill_on_drop(true)
            .spawn()
            .expect("start relay");

        tokio::time::sleep(STARTUP_WAIT).await;

        let mut agent_args = vec![
            "-H".to_string(),
            "127.0.0.1".to_string(),
            "-p".to_string(),
            RELAY_PORT.to_string(),
        ];
        agent_args.extend(agent_extra.iter().map(|s| s.to_string()));

        let agent = Command::new(find_binary("gleipnir-agent"))
            .args(&agent_args)
            .kill_on_drop(true)
            .spawn()
            .expect("start agent");

        tokio::time::sleep(STARTUP_WAIT).await;

        Self { relay, agent }
    }
}

impl Drop for TestHarness {
    fn drop(&mut self) {
        let _ = self.agent.start_kill();
        let _ = self.relay.start_kill();
        let _ = std::fs::remove_file(API_SOCKET);
    }
}

#[tokio::test]
async fn test_session_appears() {
    let _harness = TestHarness::start().await;

    let resp = api_request(r#"{"action":"sessions"}"#).await;
    assert!(resp["ok"].as_bool().unwrap());
    let sessions = resp["data"].as_array().unwrap();
    assert!(!sessions.is_empty(), "expected at least one session");
    assert!(sessions[0]["connected"].as_bool().unwrap());
}

#[tokio::test]
async fn test_exec_whoami() {
    let _harness = TestHarness::start().await;

    let resp = api_request(r#"{"action":"sessions"}"#).await;
    let session_name = resp["data"][0]["name"].as_str().unwrap().to_string();

    let req = serde_json::json!({
        "action": "exec",
        "session": session_name,
        "command": "echo hello_gleipnir",
        "timeout": 10
    });
    let resp = api_request(&req.to_string()).await;
    assert!(resp["ok"].as_bool().unwrap(), "exec failed: {resp}");
    let output = resp["data"]["output"].as_str().unwrap();
    assert!(
        output.contains("hello_gleipnir"),
        "unexpected output: {output}"
    );
}

#[tokio::test]
async fn test_file_transfer() {
    let _harness = TestHarness::start().await;

    let resp = api_request(r#"{"action":"sessions"}"#).await;
    let session_name = resp["data"][0]["name"].as_str().unwrap().to_string();

    let test_content = "gleipnir_test_content_12345";
    let upload_src = "/tmp/gleipnir_test_upload_src.txt";
    let remote_dst = "/tmp/gleipnir_test_remote.txt";
    let download_dst = "/tmp/gleipnir_test_download.txt";

    tokio::fs::write(upload_src, test_content).await.unwrap();

    // Upload
    let req = serde_json::json!({
        "action": "upload",
        "session": session_name,
        "src": upload_src,
        "dst": remote_dst,
    });
    let resp = api_request(&req.to_string()).await;
    assert!(resp["ok"].as_bool().unwrap(), "upload failed: {resp}");

    // Download
    let req = serde_json::json!({
        "action": "download",
        "session": session_name,
        "src": remote_dst,
        "dst": download_dst,
    });
    let resp = api_request(&req.to_string()).await;
    assert!(resp["ok"].as_bool().unwrap(), "download failed: {resp}");

    let downloaded = tokio::fs::read_to_string(download_dst).await.unwrap();
    assert_eq!(downloaded, test_content);

    // Cleanup
    let _ = tokio::fs::remove_file(upload_src).await;
    let _ = tokio::fs::remove_file(remote_dst).await;
    let _ = tokio::fs::remove_file(download_dst).await;
}

#[tokio::test]
async fn test_session_not_found() {
    let _harness = TestHarness::start().await;

    let req = r#"{"action":"exec","session":"nonexistent","command":"whoami"}"#;
    let resp = api_request(req).await;
    assert!(!resp["ok"].as_bool().unwrap());
    assert!(resp["error"].as_str().unwrap().contains("not found"));
}

/// TLS end-to-end: relay with explicit cert, agent with --tls (DangerousVerifier).
/// Only runs when compiled with the tls feature. Builds the agent with TLS first.
#[cfg(feature = "tls")]
#[tokio::test]
async fn test_tls_connection() {
    const TLS_RELAY_PORT: u16 = 14445;
    const TLS_API_SOCKET: &str = "/tmp/gleipnir-test-tls.sock";

    // Build agent with TLS support (it defaults to no-TLS)
    let workspace_dir = std::path::PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join("..")
        .canonicalize()
        .unwrap();
    let build = std::process::Command::new("cargo")
        .args(["build", "-p", "gleipnir-agent", "--features", "tls"])
        .current_dir(&workspace_dir)
        .status()
        .expect("build TLS agent");
    assert!(build.success(), "failed to build agent with TLS feature");

    let _ = tokio::fs::remove_file(TLS_API_SOCKET).await;

    // Generate self-signed cert with rcgen
    let cert = rcgen::generate_simple_self_signed(vec!["gleipnir".to_string()]).unwrap();
    let cert_pem = cert.cert.pem();
    let key_pem = cert.key_pair.serialize_pem();

    let cert_path = "/tmp/gleipnir-test-cert.pem";
    let key_path = "/tmp/gleipnir-test-key.pem";
    tokio::fs::write(cert_path, &cert_pem).await.unwrap();
    tokio::fs::write(key_path, &key_pem).await.unwrap();

    // Start relay with explicit TLS cert (no --no-tls)
    let relay = Command::new(find_binary("gleipnir-server"))
        .args([
            "--port",
            &TLS_RELAY_PORT.to_string(),
            "--api-socket",
            TLS_API_SOCKET,
            "--tls-cert",
            cert_path,
            "--tls-key",
            key_path,
        ])
        .kill_on_drop(true)
        .spawn()
        .expect("start TLS relay");

    tokio::time::sleep(STARTUP_WAIT).await;

    // Start agent with --tls (uses DangerousVerifier to accept self-signed cert)
    let agent = Command::new(find_binary("gleipnir-agent"))
        .args([
            "-H",
            "127.0.0.1",
            "-p",
            &TLS_RELAY_PORT.to_string(),
            "--tls",
        ])
        .kill_on_drop(true)
        .spawn()
        .expect("start TLS agent");

    tokio::time::sleep(STARTUP_WAIT).await;

    let _harness = TlsTestHarness {
        relay,
        agent,
        cert_path: cert_path.to_string(),
        key_path: key_path.to_string(),
    };

    // Verify session connected through TLS
    let tls_api_request = |req: &str| {
        let req = req.to_string();
        async move {
            let stream = UnixStream::connect(TLS_API_SOCKET)
                .await
                .expect("connect to TLS API socket");
            let (reader, mut writer) = stream.into_split();
            let mut line = req;
            line.push('\n');
            writer
                .write_all(line.as_bytes())
                .await
                .expect("write request");
            let mut reader = BufReader::new(reader);
            let mut response = String::new();
            timeout(CMD_TIMEOUT, reader.read_line(&mut response))
                .await
                .expect("TLS response timeout")
                .expect("TLS read response");
            serde_json::from_str::<serde_json::Value>(&response).expect("parse TLS JSON response")
        }
    };

    let resp = tls_api_request(r#"{"action":"sessions"}"#).await;
    assert!(resp["ok"].as_bool().unwrap(), "sessions failed: {resp}");
    let sessions = resp["data"].as_array().unwrap();
    assert!(!sessions.is_empty(), "expected a TLS session, got none");
    assert!(sessions[0]["connected"].as_bool().unwrap());

    // Execute a command through TLS
    let session_name = sessions[0]["name"].as_str().unwrap().to_string();
    let req = serde_json::json!({
        "action": "exec",
        "session": session_name,
        "command": "echo tls_works",
        "timeout": 10
    });
    let resp = tls_api_request(&req.to_string()).await;
    assert!(resp["ok"].as_bool().unwrap(), "TLS exec failed: {resp}");
    let output = resp["data"]["output"].as_str().unwrap();
    assert!(
        output.contains("tls_works"),
        "unexpected TLS output: {output}"
    );
}

#[cfg(feature = "tls")]
struct TlsTestHarness {
    relay: tokio::process::Child,
    agent: tokio::process::Child,
    cert_path: String,
    key_path: String,
}

#[cfg(feature = "tls")]
impl Drop for TlsTestHarness {
    fn drop(&mut self) {
        let _ = self.agent.start_kill();
        let _ = self.relay.start_kill();
        let _ = std::fs::remove_file(&self.cert_path);
        let _ = std::fs::remove_file(&self.key_path);
        let _ = std::fs::remove_file("/tmp/gleipnir-test-tls.sock");
    }
}

// ── Raw session tests ──

const RAW_RELAY_PORT: u16 = 14446;
const RAW_API_SOCKET: &str = "/tmp/gleipnir-test-raw.sock";

async fn raw_api_request(req: &str) -> serde_json::Value {
    let stream = UnixStream::connect(RAW_API_SOCKET)
        .await
        .expect("connect to raw API socket");
    let (reader, mut writer) = stream.into_split();

    let mut line = req.to_string();
    line.push('\n');
    writer
        .write_all(line.as_bytes())
        .await
        .expect("write request");

    let mut reader = BufReader::new(reader);
    let mut response = String::new();
    timeout(CMD_TIMEOUT, reader.read_line(&mut response))
        .await
        .expect("response timeout")
        .expect("read response");

    serde_json::from_str(&response).expect("parse JSON response")
}

struct RawTestHarness {
    relay: tokio::process::Child,
    mock_handle: tokio::task::JoinHandle<()>,
}

impl Drop for RawTestHarness {
    fn drop(&mut self) {
        self.mock_handle.abort();
        let _ = self.relay.start_kill();
        let _ = std::fs::remove_file(RAW_API_SOCKET);
    }
}

/// Mock shell: reads commands line-by-line and sends canned responses.
/// Handles id, hostname, PTY upgrade attempts, and marker-based exec.
async fn run_mock_shell(mut stream: tokio::net::TcpStream) {
    // Send initial prompt so auto-detect resolves quickly
    let _ = stream.write_all(b"$ ").await;

    let mut buf = vec![0u8; 8192];
    let mut pending = String::new();

    loop {
        match timeout(Duration::from_secs(30), stream.read(&mut buf)).await {
            Ok(Ok(0)) | Err(_) => break,
            Ok(Err(_)) => break,
            Ok(Ok(n)) => {
                pending.push_str(&String::from_utf8_lossy(&buf[..n]));

                while let Some(nl) = pending.find('\n') {
                    let line = pending[..nl].to_string();
                    pending = pending[nl + 1..].to_string();

                    if let Some(response) = mock_handle_command(&line) {
                        let _ = stream.write_all(response.as_bytes()).await;
                    }
                }
            }
        }
    }
}

fn mock_handle_command(cmd: &str) -> Option<String> {
    let cmd = cmd.trim();

    if cmd == "id" {
        Some("uid=1000(tester) gid=1000(tester) groups=1000(tester)\n".into())
    } else if cmd == "hostname" {
        Some("mockbox\n".into())
    } else if cmd.contains("python3") || cmd.contains("script -q") {
        // PTY upgrade attempt
        Some(String::new())
    } else if cmd.contains("; echo __GLEIPNIR_") {
        // Marker-based exec: "{actual_cmd}; echo {marker}"
        let parts: Vec<&str> = cmd.splitn(2, "; echo ").collect();
        if parts.len() == 2 {
            let actual = parts[0].trim();
            let marker = parts[1].trim();
            let output = mock_exec(actual);
            Some(format!("{output}{marker}\n"))
        } else {
            None
        }
    } else {
        None
    }
}

fn mock_exec(cmd: &str) -> String {
    if cmd == "echo hello_raw" {
        "hello_raw\n".into()
    } else if cmd == "whoami" {
        "tester\n".into()
    } else {
        format!("mock: {cmd}\n")
    }
}

#[tokio::test]
async fn test_raw_session() {
    let _ = tokio::fs::remove_file(RAW_API_SOCKET).await;

    let mut relay_args = vec![
        "--port".to_string(),
        RAW_RELAY_PORT.to_string(),
        "--api-socket".to_string(),
        RAW_API_SOCKET.to_string(),
        "--api-port".to_string(),
        "0".to_string(),
    ];
    #[cfg(feature = "tls")]
    relay_args.push("--no-tls".to_string());

    let relay = Command::new(find_binary("gleipnir-server"))
        .args(&relay_args)
        .kill_on_drop(true)
        .spawn()
        .expect("start relay for raw test");

    tokio::time::sleep(STARTUP_WAIT).await;

    // Connect a raw TCP socket (no PKRL protocol)
    let stream = tokio::net::TcpStream::connect(format!("127.0.0.1:{RAW_RELAY_PORT}"))
        .await
        .expect("connect raw TCP");

    let mock_handle = tokio::spawn(async move {
        run_mock_shell(stream).await;
    });

    // Wait for probe_and_upgrade to finish and session to register.
    // The probe sends id, hostname, and PTY upgrade attempts with various timeouts.
    tokio::time::sleep(Duration::from_secs(8)).await;

    let _harness = RawTestHarness {
        relay,
        mock_handle,
    };

    // Verify session appeared with mode=raw
    let resp = raw_api_request(r#"{"action":"sessions"}"#).await;
    assert!(resp["ok"].as_bool().unwrap(), "sessions failed: {resp}");
    let sessions = resp["data"].as_array().unwrap();
    assert!(!sessions.is_empty(), "expected a raw session, got none");
    assert_eq!(
        sessions[0]["mode"].as_str().unwrap(),
        "raw",
        "expected mode=raw"
    );
    assert!(sessions[0]["connected"].as_bool().unwrap());
    assert_eq!(sessions[0]["username"].as_str().unwrap(), "tester");

    // Execute a command through the raw session
    let session_name = sessions[0]["name"].as_str().unwrap().to_string();
    let req = serde_json::json!({
        "action": "exec",
        "session": session_name,
        "command": "echo hello_raw",
        "timeout": 10
    });
    let resp = raw_api_request(&req.to_string()).await;
    assert!(resp["ok"].as_bool().unwrap(), "raw exec failed: {resp}");
    let output = resp["data"]["output"].as_str().unwrap();
    assert!(
        output.contains("hello_raw"),
        "unexpected raw exec output: {output}"
    );

    // Verify upload is rejected for raw sessions
    let req = serde_json::json!({
        "action": "upload",
        "session": session_name,
        "src": "/tmp/nonexistent",
        "dst": "/tmp/nonexistent"
    });
    let resp = raw_api_request(&req.to_string()).await;
    assert!(!resp["ok"].as_bool().unwrap(), "upload should fail for raw sessions");
    assert!(
        resp["error"].as_str().unwrap().contains("not supported"),
        "expected 'not supported' error, got: {}",
        resp["error"]
    );
}
