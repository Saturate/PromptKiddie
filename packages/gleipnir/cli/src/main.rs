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
                                        let user = s
                                            .get("username")
                                            .and_then(|v| v.as_str())
                                            .unwrap_or("?");
                                        let host = s
                                            .get("hostname")
                                            .and_then(|v| v.as_str())
                                            .unwrap_or("?");
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
