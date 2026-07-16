# Plan: Unified API Architecture Migration

## Context

Five consumers all connect to Postgres directly via `@promptkiddie/core`. Two duplicate API surfaces exist (Next.js API routes + standalone Hono server). Agent containers hold DB credentials. The supervisor runs its own WebSocket server.

Target state: one Hono API server is the only thing that touches Postgres. Everything else is an HTTP/WebSocket client. Next.js replaced with a Vite SPA served by the API.

Spec: `docs/specs/unified-api-architecture.md`

## Key findings from codebase

- `createHttpRepo()` in `packages/core/src/client.ts` already fully implements all 50+ Repo methods over HTTP. The HTTP client is complete.
- The Hono API (`packages/api`) has 9 route files but is missing ~8 route groups: services, ports, events, discoveries, exec-dedup, steps, playbooks, webshells.
- The supervisor (`packages/supervisor/src/index.ts`) is the hardest target: direct `@promptkiddie/core` imports + raw pg LISTEN/NOTIFY.
- Playbook action definitions (CTF_ACTIONS etc.) contain executable code (trigger functions, run functions). They stay as code imports in the supervisor, not served from the API.
- Chat page uses Vercel AI SDK streaming. Will move to Hono API (`POST /chat`).

---

## Phase 0: Complete the API surface

All tasks parallel, no dependencies. Mechanical route-adding following existing patterns in `packages/api/src/routes/`.

### Task 0.1: Service routes [S]
Add `routes/services.ts`: CRUD for services, apps, creds, CVEs.
- **AC:** `createHttpRepo()` service methods return correct data when hitting the API
- **Files:** `packages/api/src/routes/services.ts`, `packages/api/src/app.ts`

### Task 0.2: Port routes [S]
Add `routes/ports.ts`: add, list, update ports on targets.
- **AC:** Port CRUD works through the API

### Task 0.3: Event + discovery routes [S]
Add `routes/events.ts` and `routes/discoveries.ts`: emit/list events, add/list/summarize discoveries.
- **AC:** `emitEvent`, `listEvents`, `addDiscovery`, `listDiscoveries`, `getDiscoverySummary` work via HTTP

### Task 0.4: Exec-dedup routes [S]
Add `routes/exec-dedup.ts`: record outcomes, check blocked.
- **AC:** `recordExecOutcome`, `isExecBlocked` work via HTTP

### Task 0.5: Steps + playbook routes [M]
Add `routes/steps.ts` and `routes/playbooks.ts`: step lifecycle, playbook CRUD, default playbook lookup.
- **AC:** All step and playbook operations work via HTTP

### Task 0.6: Webshell routes [S]
Add `routes/webshells.ts`: register, list, get webshells.
- **AC:** Webshell operations work via HTTP

### Task 0.7: Knowledge routes [S]
Add `routes/knowledge.ts`: search, ingest, list/clear sources.
- **AC:** Knowledge search and ingestion work via HTTP

### Checkpoint: After Phase 0
- [ ] Every method in `createHttpRepo()` has a corresponding API route
- [ ] Existing tests still pass
- [ ] `pk` CLI works with `PK_API_URL` set (already works, just verify)

---

## Phase 1: API key identity system

### Task 1.1: Multi-key auth middleware [M]
Replace single bearer token with `PK_API_KEYS` env var parsing. Middleware extracts key identity and sets `c.set("keyIdentity", "cli:allan")`.
- **AC:** Multiple keys accepted, identity available in route handlers
- **Files:** `packages/api/src/index.ts`, new `packages/api/src/middleware/auth.ts`

### Task 1.2: Attribution schema migration [S]
Add `created_by TEXT` column to activity_log, findings, evidence, targets, services, discoveries, events, agent_runs.
- **AC:** Migration runs, columns exist, nullable for backwards compat
- **Files:** `db/migrations/0018_attribution.sql`

### Task 1.3: Server-side attribution stamping [S]
Route handlers read `c.get("keyIdentity")` and stamp `created_by`/`actor`/`source` on mutations.
- **Depends on:** 1.1, 1.2
- **AC:** Activity log entries have correct `actor` from API key, not caller-supplied

---

## Phase 2: WebSocket event system

### Task 2.1: Event broadcast WebSocket [M]
Add `/ws/events` endpoint to the API. Single pg LISTEN client on `pk_events` channel, broadcast to subscribed WebSocket clients. Auth via query param or first message.
- **Depends on:** 0.3
- **AC:** WebSocket client receives events in real-time when `emitEvent` is called
- **Files:** new `packages/api/src/ws.ts`, `packages/api/src/index.ts`

### Task 2.2: PTY streaming WebSocket [M]
Add `/ws/agents/:id/pty` endpoint. Relay: supervisor pushes output via `POST /agents/:id/output`, API broadcasts to subscribed frontends.
- **Depends on:** 2.1
- **AC:** Frontend receives live terminal output from agent actions

### Checkpoint: After Phase 1-2
- [ ] API accepts multiple keys with identity
- [ ] Mutations are stamped with creator identity
- [ ] WebSocket event stream works end-to-end
- [ ] Review with human before migrating consumers

---

## Phase 3: Migrate consumers to HTTP-only

### Task 3.1: CLI HTTP-only [S]
Make `api.url` required. Replace direct core imports (`addEvidence`, `getEngagement`, etc.) with `repo.*` calls.
- **Depends on:** Phase 0
- **AC:** CLI works without `DATABASE_URL`, only needs `PK_API_URL` + `PK_API_KEY`

### Task 3.2: MCP server HTTP-only [S]
Add validation that `api.url` is set. Remove `closeDb` import.
- **Depends on:** Phase 0
- **AC:** MCP server works without `DATABASE_URL`

### Task 3.3: Supervisor data mutations to HTTP [L - split into 2 sessions]
Replace all direct `@promptkiddie/core` repo imports in `index.ts` and `run-context.ts` with `createHttpRepo()` calls. Keep action/type imports.
- **Depends on:** Phase 0
- **AC:** Supervisor makes no direct DB calls for data mutations
- **Files:** `packages/supervisor/src/index.ts`, `packages/supervisor/src/run-context.ts`

### Task 3.4: Supervisor LISTEN/NOTIFY to WebSocket [M]
Replace `new Client(DATABASE_URL)` + `LISTEN pk_events` with WebSocket client to `/ws/events`. Remove `DATABASE_URL` from supervisor config.
- **Depends on:** 2.1, 3.3
- **AC:** Supervisor receives events via WebSocket, no Postgres connection

### Task 3.5: Remove supervisor's WebSocket server [S]
Delete `ws-server.ts`. Supervisor is now only a client.
- **Depends on:** 3.4
- **AC:** No port 3201 listener, supervisor is stateless relay

### Task 3.6: Agent containers get API keys [S]
Replace `DATABASE_URL` env var with `PK_API_URL` + `PK_API_KEY` in agent container spawning.
- **Depends on:** 3.1, 3.3
- **AC:** Agent containers have no DB credentials

### Checkpoint: After Phase 3
- [ ] No consumer except the API touches Postgres
- [ ] `DATABASE_URL` only in API and docker-compose postgres service
- [ ] All existing functionality still works
- [ ] Review with human before frontend swap

---

## Phase 4: Next.js to Vite SPA

### Task 4.1: Scaffold Vite + React project [M]
Create `packages/spa/` with Vite, React, TailwindCSS v4, React Router. Move reusable components from `packages/web/src/components/`.
- **AC:** `pnpm dev` serves an empty shell with routing

### Task 4.2: API client + data hooks [S]
Create typed fetch wrappers and React hooks for data fetching. Browser-friendly (relative URLs, cookies).
- **Depends on:** 4.1
- **AC:** `useEngagements()`, `useFindings()` etc. return data from the API

### Task 4.3: Convert pages [L - split across sessions]
Convert Next.js pages to client components with data fetching. Replace `Link` with React Router, `revalidatePath` with re-fetch.
- **Depends on:** 4.2
- Pages: dashboard, engagements, engagement detail, settings, playbook, knowledge, stats, tools

### Task 4.4: WebSocket hooks for live updates [M]
Create `useEventStream()` hook. Replace polling with WebSocket subscriptions.
- **Depends on:** 2.1, 4.1

### Task 4.5: Chat route in Hono API [M]
Add `POST /chat` with AI SDK streaming. SPA renders with EventSource or streaming fetch.
- **Depends on:** 4.3

### Task 4.6: Serve SPA from Hono [S]
Add `serveStatic` middleware for `packages/spa/dist/`. SPA fallback for non-API routes.
- **Depends on:** 4.1

---

## Phase 5: Cleanup

### Task 5.1: Delete Next.js API routes and web package [S]
Remove `packages/web/` entirely once SPA is verified.

### Task 5.2: Update docker-compose [S]
Remove `web` service. API always runs (not behind profile). Add `PK_API_KEYS` generation.

### Task 5.3: Update pk init [M]
Generate API keys, write to `.pk/config.toml` and `.env`. Always start API service.

### Task 5.4: Remove createLocalRepo() [S]
Final cut. `getRepo()` always returns `createHttpRepo()`. Requires `api.url`.

### Final checkpoint
- [ ] One API server, one DB connection pool
- [ ] SPA served from API on same port
- [ ] All consumers use HTTP/WebSocket
- [ ] Attribution works end-to-end
- [ ] `docker compose up` starts everything correctly

---

## Verification

After each phase:
1. `pnpm build` succeeds
2. `pk engagement list` works via API
3. Supervisor processes events from a test engagement
4. Web UI loads and displays engagement data
5. MCP tools respond correctly in Claude Code

## Risks

- **Chat/AI streaming:** Vercel AI SDK's `streamText` needs testing with Hono's `stream()` helper. Prototype early.
- **Supervisor size:** `index.ts` is 25k lines. The migration (3.3) should be split into two sessions: first `run-context.ts`, then `index.ts`.
- **Knowledge embeddings:** The API process needs the embedding model loaded for search. Already happens via `@promptkiddie/core` import.
