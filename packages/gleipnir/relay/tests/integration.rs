use std::time::Duration;
use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader};
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
        let _ = tokio::fs::remove_file(API_SOCKET).await;

        let relay = Command::new(find_binary("gleipnir-relay"))
            .args([
                "--port",
                &RELAY_PORT.to_string(),
                "--api-socket",
                API_SOCKET,
            ])
            .kill_on_drop(true)
            .spawn()
            .expect("start relay");

        tokio::time::sleep(STARTUP_WAIT).await;

        let agent = Command::new(find_binary("gleipnir-agent"))
            .args(["-H", "127.0.0.1", "-p", &RELAY_PORT.to_string()])
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
