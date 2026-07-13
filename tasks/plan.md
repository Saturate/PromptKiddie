# Plan: CLI Hardening (pk-rs best-of)

Extract the best ideas from the pk-rs spec into the existing TypeScript CLI. No rewrite; targeted improvements.

**Already exists (removed from scope):**
- `pk engagement use <id>` - works via `.pk/state.json`
- `pk search <term>` - greps `engagements/<slug>/`
- `pk think` - writes to agent_log

## Dependency graph

```
Task 1: Config: /etc/pk/config.toml + PK_CONTAINER detection
    │
    ├── Task 2: Spawn: mount config, hide DATABASE_URL, add $TARGET_SUBNET
    │
    └── Task 3: Container mode guards (disable vpn/spawn, default actor=agent)

Task 4: pk search --tool-log (search shell-logger outputs)
    └── standalone

Task 5: TTY-aware output formatting
    └── standalone
```

---

## Task 1: Config resolution for container mode

**Description:** Add `/etc/pk/config.toml` to the config resolution chain (highest priority file path, before env overrides). Add `PK_CONTAINER` detection to the config object so downstream code can check it.

**Acceptance criteria:**
- [ ] Config resolution order: defaults < `~/.pk/config.toml` < `.pk/config.toml` < `/etc/pk/config.toml` < env vars
- [ ] `PkConfig` has a `container: boolean` field, true when `PK_CONTAINER=1`
- [ ] When `container` is true and `/etc/pk/config.toml` has `database.url`, that value is used even if `DATABASE_URL` env is not set

**Verification:**
- [ ] `pnpm build` succeeds
- [ ] `pk config` shows the merged config with `container: false` on the host

**Dependencies:** None

**Files likely touched:**
- `packages/core/src/config.ts`

**Estimated scope:** S

---

## Task 2: Spawn improvements (config mount, hidden creds, $TARGET_SUBNET)

**Description:** Update `pk spawn agent` to (a) generate and mount a `/etc/pk/config.toml` with the DB URL instead of passing `DATABASE_URL` as an env var, (b) set `PK_CONTAINER=1`, and (c) auto-detect `$TARGET_SUBNET` from the engagement scope field (CIDR regex) or accept a `--subnet` flag.

**Acceptance criteria:**
- [ ] Spawned containers get `-v <tmpfile>:/etc/pk/config.toml:ro` with the DB URL inside
- [ ] `DATABASE_URL` is NOT set as an env var on spawned containers
- [ ] `PK_CONTAINER=1` env var is set on spawned containers
- [ ] `--subnet <cidr>` flag adds `TARGET_SUBNET=<cidr>` env var
- [ ] When no `--subnet` flag, auto-detect CIDR from engagement scope field (regex: `/\d+\.\d+\.\d+\.\d+\/\d+/`)
- [ ] Temp config file is cleaned up after container stops (or left in a known location)

**Verification:**
- [ ] `pnpm build` succeeds
- [ ] `pk spawn agent --image pk-agent-recon` creates container without DATABASE_URL in env
- [ ] `docker exec <container> env | grep DATABASE` returns nothing
- [ ] `docker exec <container> pk engagement list` works (reads from /etc/pk/config.toml)

**Dependencies:** Task 1

**Files likely touched:**
- `packages/cli/src/index.ts` (spawn command)

**Estimated scope:** S

---

## Task 3: Container mode guards

**Description:** When `PK_CONTAINER=1` is set, disable host-only commands (`vpn`, `spawn`) with a clear error message, and default the `--actor` flag to `"agent"` instead of `"orchestrator"` for activity logging.

**Acceptance criteria:**
- [ ] `pk vpn up` inside a container prints "VPN commands are not available inside agent containers" and exits 1
- [ ] `pk spawn agent` inside a container prints "Spawn is not available inside agent containers" and exits 1
- [ ] `pk activity log` defaults actor to `"agent"` when `PK_CONTAINER=1`
- [ ] Host mode (no `PK_CONTAINER`) is unchanged

**Verification:**
- [ ] `pnpm build` succeeds
- [ ] Manual: `PK_CONTAINER=1 pk vpn status` shows error
- [ ] Manual: `pk vpn status` on host works normally

**Dependencies:** Task 1

**Files likely touched:**
- `packages/cli/src/index.ts`

**Estimated scope:** S

---

## Checkpoint: After Tasks 1-3
- [ ] `pnpm build` succeeds
- [ ] Existing tests pass
- [ ] `pk spawn` creates containers with mounted config, no DATABASE_URL in env
- [ ] Container mode guards work

---

## Task 4: pk search --tool-log

**Description:** Extend `pk search` with a `--tool-log` flag that searches shell-logger output files at `$PK_LOG_DIR/outputs/` (default `/workspace/.tool-log/outputs/`) instead of the engagement directory. Also support `--cmd <tool>` to filter by tool name (matches output filenames like `nmap-2026-07-11T11-38-12.txt`). This is the primary use case inside containers where agents want to find data from earlier commands.

**Acceptance criteria:**
- [ ] `pk search <term> --tool-log` greps files in `$PK_LOG_DIR/outputs/` (or `/workspace/.tool-log/outputs/`)
- [ ] `pk search <term> --tool-log --cmd nmap` only searches files matching `nmap-*`
- [ ] Output shows filename and matching lines
- [ ] Falls back to existing engagement-dir search when `--tool-log` is not set

**Verification:**
- [ ] `pnpm build` succeeds
- [ ] Manual: create a test output file, verify `pk search` finds content in it

**Dependencies:** None

**Files likely touched:**
- `packages/cli/src/index.ts` (search command)

**Estimated scope:** S

---

## Task 5: TTY-aware output formatting

**Description:** When stdout is a TTY (human at terminal), output key commands in human-readable format instead of raw JSON. When piped or redirected, keep JSON. Add `--format json|text` global flag to override. Start with `pk service list`, `pk finding list`, `pk target list`, and `pk engagement list` since those are the most commonly read by humans.

**Acceptance criteria:**
- [ ] `pk finding list` on a TTY shows a table (title, severity, status, one row per finding)
- [ ] `pk finding list | cat` outputs JSON (pipe detection)
- [ ] `pk finding list --format json` forces JSON even on TTY
- [ ] `pk target list` on a TTY shows a table (kind, identifier, in-scope, notes)
- [ ] `pk service list` on a TTY shows a table (port, product, version, apps count, creds count)
- [ ] `pk engagement list` on a TTY shows a table (name, type, status, phase)
- [ ] All other commands continue to output JSON (no regression)

**Verification:**
- [ ] `pnpm build` succeeds
- [ ] Manual: `pk finding list` in terminal shows formatted table
- [ ] Manual: `pk finding list | jq .` still works (JSON output when piped)

**Dependencies:** None

**Files likely touched:**
- `packages/cli/src/index.ts` (out function, global option, 4 list commands)

**Estimated scope:** M

---

## Final checkpoint
- [ ] `pnpm build` succeeds
- [ ] All tests pass
- [ ] Spawned containers can't leak DB credentials via `env`
- [ ] Host-only commands are blocked inside containers
- [ ] `pk search --tool-log` works inside containers
- [ ] Human-friendly output on TTY, JSON when piped
