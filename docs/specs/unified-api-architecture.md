# Unified API Architecture

**Date:** 2026-07-16
**Status:** Proposed
**Supersedes:** api-only-access (removed)

## Problem

The current architecture has five consumers all importing `@promptkiddie/core` and connecting to Postgres directly:

- Web UI (Next.js API routes, its own DB connection)
- CLI (`pk`, via `createLocalRepo()`)
- MCP server (via `getRepo()`)
- Supervisor (direct `pg` client for LISTEN/NOTIFY, plus core imports for mutations)
- Agent containers (mount `DATABASE_URL`, run `pk` CLI inside)

This creates:

- Two duplicate API surfaces (Next.js routes + standalone Hono server)
- No single auth/validation/rate-limit layer
- Agent containers holding DB credentials (security surface)
- Schema changes breaking all consumers simultaneously
- The supervisor running its own WebSocket server for the web UI

## Proposal

One API server. Everything else is a client. Postgres is only touched by the API.

```
Frontend (SPA) ----+
CLI                |
MCP server         +--> API (Hono) ----> Postgres
Supervisor         |
Agents             |
Cartridge          +
```

### 1. Replace Next.js with a static SPA

The web UI is a dashboard. No SSR, no SEO, no server-side data fetching needed. Replace Next.js with Vite + React (or keep the React components, just swap the build).

- All data fetching via `fetch()` to the API
- Auth via API key in a cookie or header, provisioned by docker compose
- Static files served by the API server or a separate nginx/caddy

### 2. One Hono API server

The existing `packages/api` becomes the single entry point. It owns:

- **REST** for CRUD (engagements, targets, services, findings, evidence, etc.)
- **WebSocket** for events (replaces supervisor's direct LISTEN/NOTIFY)
- **WebSocket** for PTY streaming (same pattern as Cartridge's agent terminal output)
- **Auth** via API keys, one per consumer, provisioned in docker compose

The API holds the single Postgres connection pool and the single LISTEN/NOTIFY subscription. It broadcasts events over WebSocket to all subscribers.

### 3. Supervisor becomes an API client

The supervisor no longer imports from `@promptkiddie/core` or connects to Postgres. It:

- Subscribes to the API's event WebSocket
- Calls REST endpoints to mutate engagement state
- Spawns agents via the Cartridge API (already does this)
- Receives an API key via env var

### 4. CLI and MCP server use HTTP only

Remove `createLocalRepo()` from `packages/core/src/client.ts`. The `getRepo()` function returns `createHttpRepo()` only. The CLI and MCP server need `API_URL` and `API_KEY`, not `DATABASE_URL`.

### 5. Agent containers get API access, not DB access

Agents receive `API_URL` and `API_KEY` instead of `DATABASE_URL`. The `pk` CLI inside containers talks to the API over HTTP. This removes DB credentials from target-adjacent infrastructure.

### 6. PTY streaming via the API

The API provides a WebSocket endpoint for terminal output streaming, same pattern Cartridge uses. When the supervisor or an agent runs a tool, output streams through the API WebSocket to the frontend.

The frontend subscribes to:
- `/ws/events` for engagement events (PortDiscovered, etc.)
- `/ws/agents/:id/pty` for live agent terminal output

### 7. API key provisioning

Docker compose generates keys on first run and injects them as env vars:

```yaml
services:
  api:
    environment:
      - PK_API_KEYS=web:${WEB_KEY},supervisor:${SUPERVISOR_KEY},cli:${CLI_KEY}

  supervisor:
    environment:
      - PK_API_URL=http://api:3200
      - PK_API_KEY=${SUPERVISOR_KEY}
```

For `pk init` host mode, the CLI key is written to `.pk/config.toml`.

## Migration path

1. Add WebSocket event broadcasting to the Hono API
2. Move supervisor to API client (REST + WebSocket)
3. Remove `createLocalRepo()`, CLI/MCP go HTTP-only
4. Strip agent containers of `DATABASE_URL`
5. Replace Next.js with Vite SPA
6. Remove `packages/web/src/app/api/` (Next.js API routes)
7. Add PTY streaming WebSocket endpoint

Steps 1-4 can land incrementally. Step 5 is the big frontend swap. Step 6 is cleanup. Step 7 can happen in parallel.

## Architecture after

```
                    +------------------+
  Frontend (SPA) -->|                  |
  CLI            -->|   API (Hono)     |--> Postgres
  MCP server     -->|                  |
  Supervisor     -->| REST + WebSocket |
  Agents         -->|                  |
                    +------------------+
```

## Attribution

Every API key has an identity (`supervisor`, `cli`, `agent-recon-7f3a`, `web`). The API stamps this on every mutation server-side, replacing the current manual `actor` field that consumers pass as a string.

### What changes

- Activity log: `actor` is set by the API from the key identity, not passed by the caller
- Findings, evidence, targets: new `created_by` column, auto-populated from the key
- Events: `source` field stamped from key identity instead of caller-provided string
- Agent runs: correlated by key, no need for separate `agent` field

### What this enables

- "What did agent X do this engagement?" - filter by key identity
- "Who added this finding?" - `created_by` is trustworthy (server-stamped, not self-reported)
- Audit trail per consumer without any consumer cooperation
- Rate limiting or kill-switch per agent if one goes rogue

### Key identity format

```
<role>:<instance>

supervisor:default
cli:allan
web:session-abc123
agent:recon-7f3a
agent:exploit-2b1c
```

The role determines permissions (agents can't delete engagements, web can't spawn containers). The instance provides traceability. Agent keys are generated per spawn and revoked when the agent container stops.

## Not doing

- GraphQL (REST + WebSocket is simpler for this domain)
- gRPC (adds complexity, no polyglot need)
- Multi-tenant auth (single-user for now, API keys are enough)
