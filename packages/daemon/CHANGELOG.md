## 0.1.2 (2026-07-21)

### Features

- unified API architecture (all phases) (#8)

#### SPA redesign with orchestrator agent and end-to-end supervisor.

Removed step-based playbook engine (bt-runtime, playbook-md) and related schema tables. Added `image` and `emits` fields to the action SDK.

API now embeds the supervisor lifecycle, exposes status and playbook-action routes, and relays agent terminal sessions over WebSocket with PTY support.

Supervisor dispatches actions on events with a dedup guard, spawning per-engagement worker and orchestrator containers.

CLI and MCP server drop legacy step/inbox/message commands. Web removes playbook settings page (replaced by SPA).

### Fixes

- move engagement hooks behind pk init (#7)

## 0.1.1 (2026-07-16)

### Features

- lifecycle management, compose service, direct docker spawn
- start agents via Cartridge API instead of PK inbox

### Fixes

- forward provider keys and harness config to agent containers
- write cartridge.toml for agent containers instead of env vars
- forward CLAUDE_CODE_OAUTH_TOKEN to agent containers
