# Reactive Playbooks: Foundation Tables + Context Builder

Implements roadmap items 3, 5, and 6 from `docs/specs/reactive-playbooks.md`.
Items 1-2 (exploit cards, chunking fix) are already shipped.

## Task 1: Events table + NOTIFY trigger

**Status**: pending
**Depends on**: none
**Files**: `packages/core/src/schema.ts`, SQL migration

Add the `events` table to the Drizzle schema and apply the migration. Add the
Postgres NOTIFY trigger so the future supervisor can LISTEN for new events.

**Acceptance criteria**:
- `events` table exists with columns: id (uuid), engagement_id (fk), type (text),
  payload (jsonb), source (text), created_at (timestamptz)
- Indexes on engagement_id and type
- Postgres trigger fires `pg_notify('pk_events', ...)` on INSERT
- `pnpm build` passes

## Task 2: Discoveries table

**Status**: pending
**Depends on**: Task 1
**Files**: `packages/core/src/schema.ts`, SQL migration

Add the `discoveries` table.

**Acceptance criteria**:
- `discoveries` table with: id (uuid), engagement_id (fk), type (text: positive/negative/attempted),
  category (text), summary (text), detail (jsonb), source_event_id (fk to events),
  parent_id (self-ref, nullable), superseded_by (self-ref, nullable), created_at
- Indexes on engagement_id and (engagement_id, category)
- `pnpm build` passes

## Task 3: Event + discovery repo functions

**Status**: pending
**Depends on**: Task 2
**Files**: `packages/core/src/repo.ts`

Add CRUD functions for events and discoveries: `emitEvent`, `addDiscovery`,
`listEvents`, `listDiscoveries`, `getDiscoverySummary`.

**Acceptance criteria**:
- `emitEvent(engagementId, type, payload, source)` inserts and returns the event
- `addDiscovery(engagementId, type, category, summary, detail?, sourceEventId?, parentId?)` inserts
- `listEvents(engagementId, opts?)` returns events, optionally filtered by type
- `listDiscoveries(engagementId, opts?)` returns discoveries, optionally filtered by
  category and/or type (positive/negative/attempted)
- `getDiscoverySummary(engagementId)` returns the structured JSON payload from the spec
  (ports, hostnames, versions, discoveries, etc.) suitable for LLM context injection
- `pnpm build` passes

## Task 4: CLI commands for events + discoveries

**Status**: pending
**Depends on**: Task 3
**Files**: `packages/cli/src/index.ts` (or relevant command file)

Wire up CLI commands so agents and the orchestrator can emit events and discoveries.

**Acceptance criteria**:
- `pk event emit --type PortDiscovered --payload '{"port":80,"service":"http"}'`
- `pk event list`
- `pk discovery add --type positive --category port --summary "port 80: nginx 1.28.0"`
- `pk discovery list`
- `pk context` outputs the LLM context payload JSON (calls `getDiscoverySummary`)
- All commands read the active engagement from env/config

## Task 5: Execution log dedup index

**Status**: pending
**Depends on**: none (parallel with Tasks 1-4)
**Files**: `packages/core/src/schema.ts`, `packages/core/src/repo.ts`

Add an `exec_dedup` table that indexes commands by normalized form + exit code.
The existing `pk exec` logging writes to `activityLog`; this adds a queryable
dedup layer.

**Acceptance criteria**:
- `exec_dedup` table: id, engagement_id, command_normalized (text), target (text),
  exit_code (int), count (int), first_at (timestamptz), last_at (timestamptz),
  outcome_summary (text, nullable)
- `recordExecOutcome(engagementId, command, target, exitCode, outcomeSummary?)` upserts
  (increments count if same command+target+exitCode exists)
- `getExecDedup(engagementId)` returns all entries for building `already_ran` and
  `failed_attempts` arrays
- `isExecBlocked(engagementId, command, target)` returns true if same command failed
  2+ times (hard guard)
- `pnpm build` passes

## Task 6: LLM context payload builder

**Status**: pending
**Depends on**: Task 3, Task 5
**Files**: `packages/core/src/context-builder.ts` (new)

Build the structured JSON payload that every LLM invocation receives. Queries
discoveries, exec dedup, findings, and artifacts into the format from spec S4.

**Acceptance criteria**:
- `buildLlmContext(engagementId)` returns the JSON object matching the spec:
  target, ports, hostnames, versions, downloaded_files, discoveries,
  already_ran, failed_attempts, findings, artifacts
- Token estimate included in output (`estimated_tokens` field)
- Exported from `packages/core/src/index.ts`
- `pnpm build` passes

## Task 7: MCP tool for context payload

**Status**: pending
**Depends on**: Task 6
**Files**: MCP server tool definition

Expose `get_context` as an MCP tool so agents can call it to get their structured
context payload.

**Acceptance criteria**:
- `get_context` MCP tool returns the LLM context JSON for the active engagement
- Existing `search_knowledge` MCP tool still works
- `pnpm build` passes
