---
gleipnir: minor
---

Add bind mode for egress-filtered targets. Agent listens on a port (`--bind -p 8443`), relay connects to it via `gleipnir connect` or `POST /api/connect`. Includes TLS support with auto-generated self-signed certs.
