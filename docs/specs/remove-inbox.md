# Remove Inbox

**Date:** 2026-07-16
**Status:** Proposed

## Problem

The `pk msg` inbox (send/poll/list) was designed for async human-agent communication before the supervisor and web chat existed. It's now dead code: the web UI has a real chat interface, and the supervisor handles agent coordination through events and the playbook graph.

The inbox adds confusion because it appears in CLI help, the DB schema has a `messages` table, and new contributors might try to use it.

## Scope

Remove:
- `pk msg send`, `pk msg poll`, `pk msg list` CLI commands (`packages/cli/src/index.ts`)
- `messages` table from the DB schema (`packages/core/src/schema.ts`)
- `sendMessage`, `pollInbox`, `listMessages` repo methods
- MCP tools: `send_message`, `poll_inbox`, `list_messages` (`packages/mcp-server/`)
- Any references in agent definitions or skill files

Keep:
- Web chat (Vercel AI SDK, separate system)
- Activity log (`pk activity log`) for audit trail
- Agent log (`pk think`) for reasoning traces

## Migration

Generate a drizzle migration that drops the `messages` table. No data migration needed since no production deployments depend on it.
