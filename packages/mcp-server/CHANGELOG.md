## 0.1.2 (2026-07-31)

### Fixes

- Publish core, daemon, mcp-server, and cli to npm. Adds `pk mcp` subcommand that starts the MCP server on stdio. `pk init ctf` now generates `npx @promptkiddie/cli mcp` for the PK MCP config and `htb --mcp-stdio` for HTB. Release workflow publishes to npm via OIDC trusted publishing.

## 0.1.1 (2026-07-21)

### Features

- unified API architecture (all phases) (#8)

### Fixes

- move engagement hooks behind pk init (#7)

#### SPA redesign with orchestrator agent and end-to-end supervisor.

Removed step-based playbook engine (bt-runtime, playbook-md) and related schema tables. Added `image` and `emits` fields to the action SDK.

API now embeds the supervisor lifecycle, exposes status and playbook-action routes, and relays agent terminal sessions over WebSocket with PTY support.

Supervisor dispatches actions on events with a dedup guard, spawning per-engagement worker and orchestrator containers.

CLI and MCP server drop legacy step/inbox/message commands. Web removes playbook settings page (replaced by SPA).
