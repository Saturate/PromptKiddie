# Plan: Orchestrator Agent

Implements SPEC.md phases 1-3. Controller (phase 4) is future work.

## Dependency graph

```
ORCHESTRATOR.md (instructions)
    └── Dockerfile (copy + role switch)
            └── Supervisor (spawn + lifecycle)
                    ├── Orchestrator prompt builder
                    ├── PTY alias registration
                    └── Stall detection removal
                            └── Agent panel UX (auto-connect)

Inbox removal (independent):
    ├── API: delete messages route
    ├── MCP: remove message tools
    ├── Core: remove from Repo interface
    └── SPA: remove client functions
```

---

## Task 1: Create ORCHESTRATOR.md

**Description:** Write the orchestrator agent instructions. Distinct from AGENT.md; the orchestrator watches, decides, and redirects rather than running tools.

**Acceptance criteria:**
- [ ] `packages/containers/agent/ORCHESTRATOR.md` exists
- [ ] Covers: role, PK MCP tools, event watching, redirecting agents, escalating to human
- [ ] References `$ENGAGEMENT_ID`, `$TARGET`, env vars

**Verification:**
- [ ] Manual review: clear, no overlap with AGENT.md

**Dependencies:** None
**Files:** `packages/containers/agent/ORCHESTRATOR.md` (new)
**Scope:** S

---

## Task 2: Dockerfile - copy ORCHESTRATOR.md + role switch

**Description:** Include ORCHESTRATOR.md in the image. Add a small entrypoint script that sets the CLAUDE.md symlink based on `PK_ROLE` env var (orchestrator vs agent).

**Acceptance criteria:**
- [ ] ORCHESTRATOR.md at `/workspace/ORCHESTRATOR.md` in the image
- [ ] `PK_ROLE=orchestrator` -> CLAUDE.md points at ORCHESTRATOR.md
- [ ] Default (no PK_ROLE) -> CLAUDE.md points at AGENT.md

**Verification:**
- [ ] `docker build -t pk-agent .` succeeds
- [ ] Role switch works in both modes

**Dependencies:** Task 1
**Files:** `packages/containers/agent/Dockerfile`, new entrypoint script
**Scope:** S

---

## Task 3: Supervisor - spawn orchestrator + lifecycle

**Description:** Spawn `pk-orch-<slug>` alongside the worker at engagement start. Reuse if exists. Stop on pause/done. Register PTY alias with `action: "orchestrator"`.

**Acceptance criteria:**
- [ ] `pk-orch-<slug>` spawned on engagement start
- [ ] Gets `PK_ROLE=orchestrator` env var
- [ ] Reused if already exists
- [ ] PTY alias registered
- [ ] Stopped on cleanup

**Verification:**
- [ ] `pnpm build` passes
- [ ] Start engagement -> `docker ps | grep pk-orch` shows container
- [ ] Pause -> stops. Resume -> reuses.

**Dependencies:** Task 2
**Files:** `packages/supervisor/src/index.ts`
**Scope:** M

---

## Task 4: Orchestrator prompt builder

**Description:** Build a dynamic prompt from engagement state. Send to Cartridge at container startup. Model configurable.

**Acceptance criteria:**
- [ ] Prompt includes engagement name, type, scope, targets, phase, recent discoveries
- [ ] Uses `buildLlmContext` from core
- [ ] Model from `playbook.meta.orchestratorModel` or global config
- [ ] Instructs orchestrator to watch events and intervene

**Verification:**
- [ ] `pnpm build` passes
- [ ] Logs show orchestrator agent started with prompt

**Dependencies:** Task 3
**Files:** `packages/supervisor/src/index.ts`, `packages/core/src/sdk.ts`
**Scope:** M

---

## Checkpoint: After Tasks 1-4
- [ ] `pnpm build` clean
- [ ] Supervisor spawns `pk-orch-<slug>` on start
- [ ] CLAUDE.md -> ORCHESTRATOR.md in the container
- [ ] Orchestrator gets engagement context prompt
- [ ] Stops on pause/done, reuses on resume
- [ ] **Human review**

---

## Task 5: Remove stall_detection

**Description:** Orchestrator replaces stall_detection. Remove the action and the stall timer from the supervisor.

**Acceptance criteria:**
- [ ] `stall_detection` removed from CTF playbook (28 actions)
- [ ] Stall timer removed from supervisor
- [ ] `StallDetected` event no longer emitted

**Verification:**
- [ ] `pnpm build` passes
- [ ] `grep -r stall_detection packages/core/src/actions/` empty

**Dependencies:** Task 3
**Files:** `packages/core/src/actions/ctf.ts`, `packages/supervisor/src/index.ts`
**Scope:** S

---

## Task 6: Agent panel - orchestrator auto-connect

**Description:** Orchestrator shows first with distinct styling. Auto-connect to its terminal when opening the panel on an engagement page.

**Acceptance criteria:**
- [ ] Orchestrator first in engagement section, labeled "Orchestrator"
- [ ] Distinct style (steady green dot, not pulsing amber)
- [ ] Auto-connects when panel opens on engagement page
- [ ] Falls back to agent list if no orchestrator running

**Verification:**
- [ ] Open engagement -> open panel -> orchestrator terminal streams
- [ ] Close + reopen -> reconnects

**Dependencies:** Task 3
**Files:** `packages/spa/src/components/chat-panel.tsx`
**Scope:** M

---

## Task 7: Remove inbox

**Description:** Remove messages API, MCP tools, and SPA client functions. Keep DB table.

**Acceptance criteria:**
- [ ] `packages/api/src/routes/messages.ts` deleted
- [ ] Unregistered from app.ts
- [ ] MCP: `send_message`, `list_messages`, `poll_inbox` removed
- [ ] Core: removed from Repo interface + both implementations
- [ ] SPA: `fetchMessages`, `sendMessage` removed, `use-chat.ts` deleted
- [ ] DB table kept

**Verification:**
- [ ] `pnpm build` passes
- [ ] `grep -r 'sendMessage\|listMessages\|pollInbox' packages/*/src/` empty

**Dependencies:** None
**Files:** 8 files across api, mcp-server, core, spa
**Scope:** M

---

## Checkpoint: After Tasks 5-7
- [ ] Build clean, no stall_detection, no inbox
- [ ] Orchestrator auto-connects in panel
- [ ] E2e: start engagement -> orchestrator streams -> human types -> orchestrator acts
- [ ] **Human review**

---

## Summary

| Task | Title | Size | Deps | Parallel |
|------|-------|------|------|----------|
| 1 | ORCHESTRATOR.md | S | - | |
| 2 | Dockerfile role switch | S | 1 | |
| 3 | Supervisor spawn + lifecycle | M | 2 | |
| 4 | Orchestrator prompt builder | M | 3 | |
| | **Checkpoint 1** | | | |
| 5 | Remove stall_detection | S | 3 | 5+6+7 parallel |
| 6 | Agent panel auto-connect | M | 3 | 5+6+7 parallel |
| 7 | Remove inbox | M | - | 5+6+7 parallel |
| | **Checkpoint 2** | | | |
