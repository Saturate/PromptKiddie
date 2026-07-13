# Plan: Service Entity + Shell Logger Version Parsing

Implements `docs/specs/service-entity.md` and `docs/specs/shell-logger-parsing.md`.

## Dependency graph

```
Task 1: Schema (services table + findings.serviceId)
    │
    ├── Task 2: Repo functions (CRUD + auto-behaviors)
    │       │
    │       ├── Task 3: CLI commands (pk service add/update/list/show/cred/cve/app)
    │       │
    │       ├── Task 4: MCP tools (add_service, update_service, etc.)
    │       │
    │       └── Task 5: Context builder (include services in LLM context)
    │
    └── Task 6: Shell logger version parsing (regex + pk service add calls)
```

---

## Task 1: Schema and migration

**Description:** Add the `services` table to the Drizzle schema with all fields from the spec. Add a `serviceId` FK column to the `findings` table. Generate and apply the migration.

**Acceptance criteria:**
- [ ] `services` table exists with columns: id, engagementId, targetId, portId, port, protocol, name, product, version, cpe, banner, os, tech (jsonb), apps (jsonb), creds (jsonb), cves (jsonb), notes, meta (jsonb), discoveredBy, createdAt, updatedAt
- [ ] `findings.serviceId` FK column exists (nullable, references services.id, onDelete set null)
- [ ] Unique index on (engagementId, targetId, port, protocol, product) for upsert
- [ ] Migration applies cleanly against the running postgres

**Verification:**
- [ ] `pnpm build` succeeds in packages/core
- [ ] `npx drizzle-kit push` or migration applies without error
- [ ] `SELECT * FROM services LIMIT 0` succeeds in postgres

**Dependencies:** None

**Files likely touched:**
- `packages/core/src/schema.ts`
- `db/migrations/` (generated)

**Estimated scope:** S

---

## Task 2: Repo functions

**Description:** Add service CRUD functions to repo.ts. `addService` upserts by (engagementId, targetId, port, protocol, product) and auto-emits VersionIdentified event + discovery when version is present. `updateService` re-emits on version change. `addServiceCve` auto-creates a finding when status is "confirmed". `addServiceCred` also creates an artifact. Add the Repo interface entries in client.ts.

**Acceptance criteria:**
- [ ] `addService(input)` upserts and emits VersionIdentified + adds discovery when version present
- [ ] `updateService(id, input)` updates fields, re-emits VersionIdentified if version changed
- [ ] `addServiceApp(serviceId, app)` appends to apps jsonb array
- [ ] `addServiceCred(serviceId, cred)` appends to creds array, creates artifact with type "credential"
- [ ] `addServiceCve(serviceId, cve)` appends to cves array, auto-creates finding when status=confirmed
- [ ] `listServices(engagementId, opts?)` lists with optional targetId filter
- [ ] `getService(id)` returns full service with linked findings
- [ ] `listAllCreds(engagementId)` returns credentials across all services
- [ ] All functions exported from `packages/core/src/index.ts`
- [ ] Repo interface in `client.ts` updated with new methods
- [ ] createLocalRepo in `client.ts` wired up

**Verification:**
- [ ] `pnpm build` succeeds in packages/core
- [ ] Existing tests still pass: `pnpm test` in packages/core

**Dependencies:** Task 1

**Files likely touched:**
- `packages/core/src/repo.ts`
- `packages/core/src/client.ts`
- `packages/core/src/index.ts`

**Estimated scope:** M

---

## Task 3: CLI commands

**Description:** Add `pk service` command group with subcommands matching the spec. Make `pk version` an alias that calls `addService` internally. Subcommands: add, update, app, cred, cve, list, show, creds.

**Acceptance criteria:**
- [ ] `pk service add --target <id> --port 80 --name http --product nginx --version 1.24.0` creates service
- [ ] `pk service update <id> --version 2.9.9 --tech php,mysql` updates service
- [ ] `pk service app <id> --name Roundcube --version 1.6.16 --path /roundcube --tech php` adds app
- [ ] `pk service cred <id> --user admin --pass secret --source "config"` adds credential
- [ ] `pk service cve <id> --cve CVE-2025-69212 --cvss 9.8 --status confirmed` adds CVE
- [ ] `pk service list` and `pk service list --target <id>` work
- [ ] `pk service show <id>` shows full detail
- [ ] `pk service creds` shows all creds across services
- [ ] `pk version --product X --version Y` still works (calls addService, prints deprecation notice)

**Verification:**
- [ ] `pnpm build` succeeds in packages/cli
- [ ] Manual: `pk service add` against test engagement creates row in DB
- [ ] Manual: `pk version` still works with deprecation notice

**Dependencies:** Task 2

**Files likely touched:**
- `packages/cli/src/index.ts`

**Estimated scope:** M

---

## Task 4: MCP tools

**Description:** Add service MCP tools to the MCP server. Update `log_version` to call `addService` internally for backward compatibility.

**Acceptance criteria:**
- [ ] `add_service` tool creates a service (mirrors pk service add)
- [ ] `update_service` tool updates a service
- [ ] `add_service_app` tool adds sub-application
- [ ] `add_service_cred` tool adds credential
- [ ] `add_service_cve` tool adds CVE
- [ ] `list_services` tool lists services for engagement, optional targetId filter
- [ ] `get_service` tool returns full service detail
- [ ] `list_all_creds` tool returns credential dump
- [ ] `log_version` now calls addService internally (backward compat, same response shape)

**Verification:**
- [ ] `pnpm build` succeeds in packages/mcp-server
- [ ] MCP server starts without error

**Dependencies:** Task 2

**Files likely touched:**
- `packages/mcp-server/src/index.ts`

**Estimated scope:** M

---

## Checkpoint: After Tasks 1-4
- [ ] `pnpm build` succeeds across all packages
- [ ] `pnpm test` passes in packages/core
- [ ] `pk service add` works end-to-end (creates service, emits event, logs discovery)
- [ ] `pk service cve <id> --status confirmed` auto-creates a finding
- [ ] `pk version` still works as an alias

---

## Task 5: Context builder

**Description:** Replace the discovery-based version list in the LLM context with structured service data. Add a `services` field to the LlmContext interface showing port, product, version, apps, credential count, and CVE status per service.

**Acceptance criteria:**
- [ ] `LlmContext` interface has a `services` field
- [ ] `buildLlmContext` queries services table and populates the field
- [ ] Each service entry includes: port, name, product, version, apps (name+version), cred_count, cves (id+status)
- [ ] Old `versions` field removed (was derived from discoveries; services replaces it)

**Verification:**
- [ ] `pnpm build` succeeds
- [ ] `pk context` output includes services section

**Dependencies:** Task 2

**Files likely touched:**
- `packages/core/src/context-builder.ts`

**Estimated scope:** S

---

## Task 6: Shell logger version parsing

**Description:** Add a post-logging regex pass to shell-logger.sh that extracts product/version pairs from command output and calls `pk service add` for each new match. Uses a per-engagement seen-versions file for dedup. Calls are backgrounded to avoid slowing command execution.

**Acceptance criteria:**
- [ ] Parses `Server: nginx/1.24.0` style headers
- [ ] Parses `X-Powered-By: PHP/8.3.6` headers
- [ ] Parses nmap port lines: `22/tcp open ssh OpenSSH 9.6p1`
- [ ] Parses known product names with versions (OpenSSH, Apache, nginx, Dovecot, MySQL, etc.)
- [ ] Deduplicates: same product+version pair only triggers `pk service add` once per engagement
- [ ] `pk service add` calls are backgrounded (don't block command execution)
- [ ] Non-matching output is ignored (no false positives on arbitrary text)

**Verification:**
- [ ] Feed sample nmap output through the logger; verify services created in DB
- [ ] Feed sample HTTP headers through the logger; verify services created
- [ ] Run same output twice; verify no duplicate `pk service add` calls

**Dependencies:** Task 3 (needs `pk service add` CLI command)

**Files likely touched:**
- `packages/scripts/shell-logger.sh`

**Estimated scope:** S

---

## Final checkpoint
- [ ] All packages build: `pnpm build`
- [ ] All tests pass: `pnpm test`
- [ ] End-to-end: nmap output through shell-logger creates services, triggers VersionIdentified events, supervisor runs cve_search
- [ ] `pk context` shows structured services instead of ad-hoc version discoveries
- [ ] `log_version` MCP tool still works (backward compat)
