use axum::extract::{Path, Request, State};
use axum::http::StatusCode;
use axum::middleware::{self, Next};
use axum::response::IntoResponse;
use axum::routing::{delete, get, post};
use axum::{Json, Router};
use serde::{Deserialize, Serialize};
use std::sync::Arc;
use std::time::Instant;
use tracing::info;

use crate::listener::{ListenerManager, ListenerMode};
use crate::session::SessionManager;
use crate::socks::SocksRelay;
use crate::ws::{self, EventBus};

#[derive(Clone)]
pub struct AppState {
    pub manager: Arc<SessionManager>,
    pub socks_relay: Arc<SocksRelay>,
    pub listener_manager: Arc<ListenerManager>,
    pub event_bus: Arc<EventBus>,
    pub started_at: Instant,
    pub agent_dir: Option<String>,
}

#[derive(Serialize)]
struct ErrorBody {
    error: String,
}

fn err(status: StatusCode, msg: impl Into<String>) -> (StatusCode, Json<ErrorBody>) {
    (status, Json(ErrorBody { error: msg.into() }))
}

async fn auth_middleware(
    State(key): State<Option<String>>,
    req: Request,
    next: Next,
) -> impl IntoResponse {
    if let Some(ref expected) = key {
        let provided = req
            .headers()
            .get("authorization")
            .and_then(|v| v.to_str().ok())
            .and_then(|v| v.strip_prefix("Bearer "));
        if provided != Some(expected.as_str()) {
            return Err(StatusCode::UNAUTHORIZED);
        }
    }
    Ok(next.run(req).await)
}

pub async fn start(port: u16, state: AppState) {
    let api_key = std::env::var("GLEIPNIR_API_KEY")
        .ok()
        .filter(|k| !k.is_empty());
    if api_key.is_none() {
        tracing::warn!("GLEIPNIR_API_KEY not set - HTTP API has no authentication");
    }

    let app = Router::new()
        .route("/api/health", get(health))
        .route("/api/info", get(info_handler))
        .route("/api/sessions", get(list_sessions))
        .route(
            "/api/sessions/{name}",
            get(get_session).delete(kill_session),
        )
        .route("/api/sessions/{name}/exec", post(exec))
        .route("/api/sessions/{name}/rename", post(rename_session))
        .route("/api/sessions/{name}/upload", post(upload))
        .route("/api/sessions/{name}/download", post(download))
        .route("/api/tunnels", get(list_tunnels).post(create_tunnel))
        .route("/api/tunnels/{session}", delete(stop_tunnel))
        .route("/api/listeners", get(list_listeners).post(create_listener))
        .route(
            "/api/listeners/{id}",
            get(get_listener).delete(close_listener),
        )
        .route("/api/connect", post(connect_to_agent))
        .route("/api/agents", get(list_agents))
        .route("/api/agents/{platform}/{arch}", get(get_agent))
        .route("/ws/events", get(ws::ws_events))
        .route("/ws/sessions/{name}", get(ws::ws_attach))
        .layer(middleware::from_fn_with_state(api_key, auth_middleware))
        .with_state(state);

    let addr = format!("0.0.0.0:{port}");
    let listener = tokio::net::TcpListener::bind(&addr)
        .await
        .unwrap_or_else(|e| panic!("failed to bind HTTP API on {addr}: {e}"));

    info!("HTTP API listening on {addr}");

    axum::serve(listener, app)
        .await
        .unwrap_or_else(|e| panic!("HTTP API server error: {e}"));
}

// ── Health & Info ──

async fn health() -> impl IntoResponse {
    Json(serde_json::json!({ "status": "ok" }))
}

async fn info_handler(State(state): State<AppState>) -> impl IntoResponse {
    let sessions = state.manager.list_sessions().await;
    let listeners = state.listener_manager.list().await;
    Json(serde_json::json!({
        "version": "0.2.0",
        "uptime_secs": state.started_at.elapsed().as_secs(),
        "sessions": sessions.len(),
        "listeners": listeners.len(),
    }))
}

// ── Sessions ──

async fn list_sessions(State(state): State<AppState>) -> impl IntoResponse {
    let sessions = state.manager.list_sessions().await;
    Json(serde_json::to_value(sessions).unwrap_or_default())
}

async fn get_session(
    State(state): State<AppState>,
    Path(name): Path<String>,
) -> Result<impl IntoResponse, (StatusCode, Json<ErrorBody>)> {
    match state.manager.get_session(&name).await {
        Some(info) => Ok(Json(serde_json::to_value(info).unwrap_or_default())),
        None => Err(err(
            StatusCode::NOT_FOUND,
            format!("session '{name}' not found"),
        )),
    }
}

#[derive(Deserialize)]
struct ExecRequest {
    command: String,
    #[serde(default = "default_timeout")]
    timeout: u64,
}

fn default_timeout() -> u64 {
    300
}

async fn exec(
    State(state): State<AppState>,
    Path(name): Path<String>,
    Json(body): Json<ExecRequest>,
) -> Result<impl IntoResponse, (StatusCode, Json<ErrorBody>)> {
    match state.manager.exec(&name, &body.command, body.timeout).await {
        Ok(output) => {
            if output.contains(&0) || std::str::from_utf8(&output).is_err() {
                use base64::Engine;
                let b64 = base64::engine::general_purpose::STANDARD.encode(&output);
                Ok(Json(
                    serde_json::json!({ "output_b64": b64, "encoding": "base64" }),
                ))
            } else {
                let text = String::from_utf8_lossy(&output).to_string();
                Ok(Json(serde_json::json!({ "output": text })))
            }
        }
        Err(e) => Err(err(StatusCode::BAD_REQUEST, e)),
    }
}

#[derive(Deserialize)]
struct UploadRequest {
    #[serde(default)]
    src_path: Option<String>,
    dst_path: String,
    #[serde(default)]
    data_b64: Option<String>,
}

async fn upload(
    State(state): State<AppState>,
    Path(name): Path<String>,
    Json(body): Json<UploadRequest>,
) -> Result<impl IntoResponse, (StatusCode, Json<ErrorBody>)> {
    if state
        .manager
        .get_session(&name)
        .await
        .is_some_and(|info| info.mode == "raw")
    {
        return Err(err(
            StatusCode::BAD_REQUEST,
            "file upload not supported for raw sessions",
        ));
    }

    let data = if let Some(b64) = &body.data_b64 {
        use base64::Engine;
        base64::engine::general_purpose::STANDARD
            .decode(b64)
            .map_err(|e| err(StatusCode::BAD_REQUEST, format!("invalid base64: {e}")))?
    } else if let Some(src) = &body.src_path {
        let resolved = std::path::Path::new(src.as_str())
            .canonicalize()
            .map(|p| p.to_string_lossy().to_string())
            .unwrap_or_else(|_| src.clone());
        let allowed = |p: &str| {
            p.starts_with("/tmp/") || p.starts_with("/private/tmp/") || p.starts_with("/workspace/")
        };
        if !allowed(&resolved) {
            return Err(err(
                StatusCode::FORBIDDEN,
                "src_path restricted to /tmp/ and /workspace/",
            ));
        }
        tokio::fs::read(src).await.map_err(|e| {
            err(
                StatusCode::BAD_REQUEST,
                format!("failed to read {src}: {e}"),
            )
        })?
    } else {
        return Err(err(
            StatusCode::BAD_REQUEST,
            "provide either data_b64 or src_path",
        ));
    };

    let size = data.len();
    let start = Instant::now();
    match state.manager.upload(&name, data, &body.dst_path).await {
        Ok(()) => Ok(Json(serde_json::json!({
            "uploaded": body.dst_path,
            "size": size,
            "elapsed_ms": start.elapsed().as_millis() as u64,
        }))),
        Err(e) => Err(err(StatusCode::BAD_REQUEST, e)),
    }
}

#[derive(Deserialize)]
struct DownloadRequest {
    remote_path: String,
}

#[derive(Serialize)]
struct DownloadResponse {
    remote_path: String,
    data_b64: String,
    size: usize,
}

async fn download(
    State(state): State<AppState>,
    Path(name): Path<String>,
    Json(body): Json<DownloadRequest>,
) -> Result<impl IntoResponse, (StatusCode, Json<ErrorBody>)> {
    if state
        .manager
        .get_session(&name)
        .await
        .is_some_and(|info| info.mode == "raw")
    {
        return Err(err(
            StatusCode::BAD_REQUEST,
            "file download not supported for raw sessions",
        ));
    }

    match state.manager.download(&name, &body.remote_path).await {
        Ok(data) => {
            use base64::Engine;
            let size = data.len();
            let b64 = base64::engine::general_purpose::STANDARD.encode(&data);
            Ok(Json(DownloadResponse {
                remote_path: body.remote_path,
                data_b64: b64,
                size,
            }))
        }
        Err(e) => Err(err(StatusCode::BAD_REQUEST, e)),
    }
}

async fn kill_session(
    State(state): State<AppState>,
    Path(name): Path<String>,
) -> Result<impl IntoResponse, (StatusCode, Json<ErrorBody>)> {
    match state.manager.kill_session(&name).await {
        Ok(()) => Ok(Json(serde_json::json!({ "killed": name }))),
        Err(e) => Err(err(StatusCode::NOT_FOUND, e)),
    }
}

#[derive(Deserialize)]
struct RenameRequest {
    name: String,
}

async fn rename_session(
    State(state): State<AppState>,
    Path(old_name): Path<String>,
    Json(body): Json<RenameRequest>,
) -> Result<impl IntoResponse, (StatusCode, Json<ErrorBody>)> {
    match state.manager.rename_session(&old_name, &body.name).await {
        Ok(info) => Ok(Json(serde_json::to_value(info).unwrap_or_default())),
        Err(e) => Err(err(StatusCode::BAD_REQUEST, e)),
    }
}

// ── Tunnels ──

#[derive(Deserialize)]
struct CreateTunnelRequest {
    session: String,
    port: u16,
}

async fn create_tunnel(
    State(state): State<AppState>,
    Json(body): Json<CreateTunnelRequest>,
) -> Result<impl IntoResponse, (StatusCode, Json<ErrorBody>)> {
    let frame_tx = state
        .manager
        .get_frame_sender(&body.session)
        .await
        .map_err(|e| err(StatusCode::BAD_REQUEST, e))?;

    let conns = state
        .manager
        .get_socks_connections(&body.session)
        .await
        .map_err(|e| err(StatusCode::BAD_REQUEST, e))?;

    match state
        .socks_relay
        .start_tunnel(&body.session, body.port, frame_tx, conns)
        .await
    {
        Ok(()) => Ok((
            StatusCode::CREATED,
            Json(serde_json::json!({
                "session": body.session,
                "port": body.port,
            })),
        )),
        Err(e) => Err(err(StatusCode::BAD_REQUEST, e)),
    }
}

async fn list_tunnels(State(state): State<AppState>) -> impl IntoResponse {
    let tunnels = state.socks_relay.list_tunnels().await;
    let data: Vec<_> = tunnels
        .into_iter()
        .map(|(name, port)| serde_json::json!({"session": name, "port": port}))
        .collect();
    Json(serde_json::json!(data))
}

async fn stop_tunnel(
    State(state): State<AppState>,
    Path(session): Path<String>,
) -> Result<impl IntoResponse, (StatusCode, Json<ErrorBody>)> {
    match state.socks_relay.stop_tunnel(&session).await {
        Ok(()) => Ok(Json(serde_json::json!({ "stopped": session }))),
        Err(e) => Err(err(StatusCode::NOT_FOUND, e)),
    }
}

// ── Listeners ──

#[derive(Deserialize)]
struct CreateListenerRequest {
    port: u16,
    #[serde(default = "default_mode")]
    mode: String,
    #[serde(default = "default_bind")]
    bind: String,
    #[serde(default)]
    name_prefix: String,
}

fn default_mode() -> String {
    "agent".into()
}

fn default_bind() -> String {
    "0.0.0.0".into()
}

async fn create_listener(
    State(state): State<AppState>,
    Json(body): Json<CreateListenerRequest>,
) -> Result<impl IntoResponse, (StatusCode, Json<ErrorBody>)> {
    let mode = ListenerMode::from_str(&body.mode).map_err(|e| err(StatusCode::BAD_REQUEST, e))?;

    match state
        .listener_manager
        .create(body.port, mode, body.bind, body.name_prefix)
        .await
    {
        Ok(info) => Ok((
            StatusCode::CREATED,
            Json(serde_json::to_value(info).unwrap_or_default()),
        )),
        Err(e) => Err(err(StatusCode::BAD_REQUEST, e)),
    }
}

async fn list_listeners(State(state): State<AppState>) -> impl IntoResponse {
    let listeners = state.listener_manager.list().await;
    Json(serde_json::to_value(listeners).unwrap_or_default())
}

async fn get_listener(
    State(state): State<AppState>,
    Path(id): Path<String>,
) -> Result<impl IntoResponse, (StatusCode, Json<ErrorBody>)> {
    match state.listener_manager.get(&id).await {
        Some(info) => Ok(Json(serde_json::to_value(info).unwrap_or_default())),
        None => Err(err(
            StatusCode::NOT_FOUND,
            format!("listener '{id}' not found"),
        )),
    }
}

async fn close_listener(
    State(state): State<AppState>,
    Path(id): Path<String>,
) -> Result<impl IntoResponse, (StatusCode, Json<ErrorBody>)> {
    match state.listener_manager.close(&id).await {
        Ok(()) => Ok(Json(serde_json::json!({ "closed": id }))),
        Err(e) => Err(err(StatusCode::NOT_FOUND, e)),
    }
}

// ── Connect out (bind mode agents) ──

#[derive(Deserialize)]
struct ConnectRequest {
    host: String,
    port: u16,
    #[serde(default)]
    tls: bool,
}

async fn connect_to_agent(
    State(state): State<AppState>,
    Json(body): Json<ConnectRequest>,
) -> Result<impl IntoResponse, (StatusCode, Json<ErrorBody>)> {
    let addr = format!("{}:{}", body.host, body.port);
    let stream = tokio::net::TcpStream::connect(&addr)
        .await
        .map_err(|e| err(StatusCode::BAD_GATEWAY, format!("connect to {addr}: {e}")))?;

    let _ = stream.set_nodelay(true);
    let sock_ref = socket2::SockRef::from(&stream);
    let keepalive = socket2::TcpKeepalive::new()
        .with_time(std::time::Duration::from_secs(5))
        .with_interval(std::time::Duration::from_secs(2));
    let _ = sock_ref.set_tcp_keepalive(&keepalive);

    let peer = stream
        .peer_addr()
        .map_err(|e| err(StatusCode::INTERNAL_SERVER_ERROR, format!("peer addr: {e}")))?;

    #[cfg(feature = "tls")]
    let boxed = if body.tls {
        let config = rustls::ClientConfig::builder()
            .dangerous()
            .with_custom_certificate_verifier(std::sync::Arc::new(DangerousClientVerifier))
            .with_no_client_auth();
        let connector =
            tokio_rustls::TlsConnector::from(std::sync::Arc::new(config));
        let server_name = rustls::pki_types::ServerName::try_from("gleipnir")
            .expect("valid server name")
            .to_owned();
        match connector.connect(server_name, stream).await {
            Ok(tls_stream) => crate::session::BoxedStream::TlsClient(tls_stream),
            Err(e) => {
                return Err(err(
                    StatusCode::BAD_GATEWAY,
                    format!("TLS handshake with {addr}: {e}"),
                ))
            }
        }
    } else {
        crate::session::BoxedStream::Tcp(stream)
    };

    #[cfg(not(feature = "tls"))]
    let boxed = crate::session::BoxedStream::Tcp(stream);

    info!("connecting out to bind agent at {addr}");
    let mgr = state.manager.clone();
    tokio::spawn(async move {
        mgr.handle_connection(boxed, peer).await;
    });

    Ok((
        StatusCode::OK,
        Json(serde_json::json!({
            "connecting": addr,
            "tls": body.tls,
        })),
    ))
}

#[cfg(feature = "tls")]
#[derive(Debug)]
struct DangerousClientVerifier;

#[cfg(feature = "tls")]
impl rustls::client::danger::ServerCertVerifier for DangerousClientVerifier {
    fn verify_server_cert(
        &self,
        _end_entity: &rustls::pki_types::CertificateDer<'_>,
        _intermediates: &[rustls::pki_types::CertificateDer<'_>],
        _server_name: &rustls::pki_types::ServerName<'_>,
        _ocsp_response: &[u8],
        _now: rustls::pki_types::UnixTime,
    ) -> Result<rustls::client::danger::ServerCertVerified, rustls::Error> {
        Ok(rustls::client::danger::ServerCertVerified::assertion())
    }

    fn verify_tls12_signature(
        &self,
        _message: &[u8],
        _cert: &rustls::pki_types::CertificateDer<'_>,
        _dss: &rustls::DigitallySignedStruct,
    ) -> Result<rustls::client::danger::HandshakeSignatureValid, rustls::Error> {
        Ok(rustls::client::danger::HandshakeSignatureValid::assertion())
    }

    fn verify_tls13_signature(
        &self,
        _message: &[u8],
        _cert: &rustls::pki_types::CertificateDer<'_>,
        _dss: &rustls::DigitallySignedStruct,
    ) -> Result<rustls::client::danger::HandshakeSignatureValid, rustls::Error> {
        Ok(rustls::client::danger::HandshakeSignatureValid::assertion())
    }

    fn supported_verify_schemes(&self) -> Vec<rustls::SignatureScheme> {
        rustls::crypto::ring::default_provider()
            .signature_verification_algorithms
            .supported_schemes()
    }
}

// ── Agent binary serving ──

async fn list_agents(
    State(state): State<AppState>,
) -> Result<impl IntoResponse, (StatusCode, Json<ErrorBody>)> {
    let Some(ref dir) = state.agent_dir else {
        return Ok(Json(serde_json::json!([])));
    };

    let mut agents = Vec::new();
    let mut entries = match tokio::fs::read_dir(dir).await {
        Ok(e) => e,
        Err(_) => return Ok(Json(serde_json::json!([]))),
    };

    while let Ok(Some(entry)) = entries.next_entry().await {
        let name = entry.file_name().to_string_lossy().to_string();
        if !name.starts_with("gleipnir-agent") {
            continue;
        }
        let parts: Vec<&str> = name.trim_end_matches(".exe").split('-').collect();
        if parts.len() >= 4 {
            let platform = parts[2];
            let arch = parts[3..].join("-");
            agents.push(serde_json::json!({
                "platform": platform,
                "arch": arch,
                "filename": name,
                "size": entry.metadata().await.map(|m| m.len()).unwrap_or(0),
            }));
        }
    }
    Ok(Json(serde_json::json!(agents)))
}

async fn get_agent(
    State(state): State<AppState>,
    Path((platform, arch)): Path<(String, String)>,
) -> Result<impl IntoResponse, (StatusCode, Json<ErrorBody>)> {
    let Some(ref dir) = state.agent_dir else {
        return Err(err(StatusCode::NOT_FOUND, "no agent directory configured"));
    };

    if platform.contains("..")
        || arch.contains("..")
        || platform.contains('/')
        || arch.contains('/')
    {
        return Err(err(StatusCode::BAD_REQUEST, "invalid platform/arch"));
    }

    let candidates = [
        format!("gleipnir-agent-{platform}-{arch}"),
        format!("gleipnir-agent-{platform}-{arch}.exe"),
        format!("gleipnir-agent-{platform}-{arch}-tls"),
        format!("gleipnir-agent-{platform}-{arch}-tls.exe"),
    ];

    for name in &candidates {
        let path = std::path::Path::new(dir).join(name);
        if path.exists() {
            match tokio::fs::read(&path).await {
                Ok(data) => {
                    return Ok((
                        StatusCode::OK,
                        [
                            ("content-type", "application/octet-stream"),
                            (
                                "content-disposition",
                                &format!("attachment; filename=\"{name}\""),
                            ),
                        ],
                        data,
                    )
                        .into_response());
                }
                Err(e) => {
                    return Err(err(
                        StatusCode::INTERNAL_SERVER_ERROR,
                        format!("failed to read agent binary: {e}"),
                    ));
                }
            }
        }
    }
    Err(err(
        StatusCode::NOT_FOUND,
        format!("no agent binary for {platform}/{arch}"),
    ))
}
