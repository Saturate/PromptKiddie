# Plan: Integration Tests

Implements `docs/specs/integration-tests.md`. Two test suites: service entity DB tests and supervisor event cascade tests.

## Dependency graph

```
Task 1: Service entity DB tests (packages/core)
    └── standalone, no deps

Task 2: Supervisor cascade tests (packages/supervisor)
    └── needs vitest config + test script in package.json

Task 3: Phase advancement tests (packages/supervisor)
    └── depends on Task 2 (same test infra)
```

---

## Task 1: Service entity DB tests

**Description:** Integration tests for service CRUD functions against the running postgres. Tests upsert, event emission, auto-behaviors (finding creation, artifact creation), dedup, and context builder integration.

**Acceptance criteria:**
- [ ] addService inserts a new service and emits VersionIdentified event
- [ ] addService upserts (same key = update, not duplicate row)
- [ ] addService does NOT emit VersionIdentified on re-submission of same data
- [ ] updateService re-emits VersionIdentified when version changes
- [ ] addServiceApp deduplicates by name+path
- [ ] addServiceCred deduplicates by username+source and creates artifact
- [ ] addServiceCve deduplicates by CVE id and auto-creates finding when status=confirmed
- [ ] listServices filters by targetId
- [ ] getService includes linked findings
- [ ] listAllCreds aggregates creds across services
- [ ] buildLlmContext includes services with apps, cred_count, cves

**Verification:**
- [ ] `pnpm --filter @promptkiddie/core test` passes with new tests
- [ ] Existing 210 tests still pass

**Dependencies:** None

**Files likely touched:**
- `packages/core/src/__tests__/service-entity.test.ts` (NEW)

**Estimated scope:** M

---

## Task 2: Supervisor event cascade tests

**Description:** Test the supervisor's evaluateAndDispatch function by starting a supervisor against the test DB with a mock playbook, calling dispatch() with synthetic events, and verifying which actions fire via onActionStart/onActionEnd callbacks. Mock the exec layer (spawnAgentContainer) to avoid needing Docker.

**Acceptance criteria:**
- [ ] EngagementStarted triggers port_scan and udp_scan
- [ ] PortDiscovered with service=http triggers web_recon, dir_brute, nuclei
- [ ] VersionIdentified with product+version triggers cve_search
- [ ] Prompt-only actions (no run function) go to inbox or spawn
- [ ] Spawn retry cap: after 2 failures, action falls back to inbox

**Verification:**
- [ ] `pnpm --filter @promptkiddie/supervisor test` passes
- [ ] Build succeeds

**Dependencies:** None (parallel with Task 1)

**Files likely touched:**
- `packages/supervisor/src/__tests__/cascade.test.ts` (NEW)
- `packages/supervisor/vitest.config.ts` (NEW)
- `packages/supervisor/package.json` (add test script + vitest dep)

**Estimated scope:** M

---

## Task 3: Phase advancement tests

**Description:** Test the supervisor's maybeAdvancePhase logic. Emit events in sequence through dispatch() and verify currentPhase advances correctly: PortDiscovered->enum, FindingAdded->exploit, ShellObtained->postexploit, FlagCaptured(root)->report.

**Acceptance criteria:**
- [ ] PortDiscovered (with no scans running) advances to enum
- [ ] FindingAdded advances to exploit
- [ ] ShellObtained advances to postexploit
- [ ] FlagCaptured with type=root advances to report
- [ ] Phase only advances forward, never backward

**Verification:**
- [ ] `pnpm --filter @promptkiddie/supervisor test` passes

**Dependencies:** Task 2

**Files likely touched:**
- `packages/supervisor/src/__tests__/cascade.test.ts` (extend)

**Estimated scope:** S

---

## Final checkpoint
- [ ] `pnpm build` succeeds
- [ ] `pnpm --filter @promptkiddie/core test` passes (all existing + new service tests)
- [ ] `pnpm --filter @promptkiddie/supervisor test` passes (cascade + phase tests)
