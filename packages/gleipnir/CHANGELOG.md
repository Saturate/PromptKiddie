## 0.1.3 (2026-08-07)

### Features

- add bind mode for egress-filtered targets (#31)
- Add bind mode for egress-filtered targets. Agent listens on a port (`--bind -p 8443`), relay connects to it via `gleipnir connect` or `POST /api/connect`. Includes TLS support with auto-generated self-signed certs.

## 0.1.2 (2026-07-31)

### Features

- v2 C2 architecture
- v2 C2 architecture: server/agent/client split with HTTP beacon mode, raw shell support, interactive CLI, chunked file transfers, and session management.

## 0.1.1 (2026-07-21)

### Features

- unified API architecture (all phases) (#8)

### Fixes

- move engagement hooks behind pk init (#7)
