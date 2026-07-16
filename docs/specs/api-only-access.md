# API-Only Data Access

**Date:** 2026-07-16
**Status:** Proposed

## Problem

`getRepo()` in `packages/core/src/client.ts` has two code paths: `createHttpRepo` (via API) and `createLocalRepo` (direct Postgres). The direct path exists for convenience in local dev but creates problems:

- Every consumer needs `DATABASE_URL` and a Postgres driver, even when the API is running
- Schema changes need to be coordinated across the API and direct-access consumers simultaneously
- The API can enforce auth, rate limits, validation, and audit logging; the direct path bypasses all of it
- Agent containers need DB credentials mounted, widening the attack surface
- The supervisor's direct DB access for LISTEN/NOTIFY is the one legitimate exception

## Proposal

Remove `createLocalRepo()`. All access goes through the HTTP API. The `pk` CLI, MCP server, and agent containers talk to `http://localhost:3200` (or the configured API URL) instead of connecting to Postgres directly.

## Changes

1. Remove `createLocalRepo()` from `packages/core/src/client.ts`
2. Make `api.url` required in config (default: `http://localhost:3200`)
3. Remove `DATABASE_URL` from agent container env, only the API and supervisor need it
4. Keep the supervisor's direct Postgres connection for LISTEN/NOTIFY (events require a persistent connection that HTTP can't provide)
5. Update `pk init` to always start the API service

## Migration

Existing `.pk/config.toml` files without `api.url` get the default on next `pk init` run. No breaking change for hosted mode (already uses the API). Host mode users need the API running, which `pk init` already starts via docker compose.

## Not doing

- Moving supervisor to API (LISTEN/NOTIFY needs a persistent PG connection)
- WebSocket subscription API for events (future, would let supervisor go through API too)
