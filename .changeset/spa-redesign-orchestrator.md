---
core: minor
api: minor
supervisor: minor
cli: patch
mcp-server: patch
web: patch
---

SPA redesign with orchestrator agent and end-to-end supervisor.

Removed step-based playbook engine (bt-runtime, playbook-md) and related schema tables. Added `image` and `emits` fields to the action SDK.

API now embeds the supervisor lifecycle, exposes status and playbook-action routes, and relays agent terminal sessions over WebSocket with PTY support.

Supervisor dispatches actions on events with a dedup guard, spawning per-engagement worker and orchestrator containers.

CLI and MCP server drop legacy step/inbox/message commands. Web removes playbook settings page (replaced by SPA).
