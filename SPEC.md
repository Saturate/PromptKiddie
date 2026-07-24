# Spec: Supervisor Agent + Global Orchestrator

## Objective

Add two new LLM tiers to the PK platform:

1. **Supervisor** - a persistent per-engagement LLM agent that watches the engagement holistically, intervenes when the playbook runs out of ideas, and redirects stuck task agents. Replaces the throwaway stall_detection pattern.

2. **Orchestrator** (hosted or host mode) - a global LLM that manages PK state across engagements: creates engagements, assigns playbooks, starts/stops them. Not scoped to a single engagement. In host mode, the user's own harness (Claude Code, etc.) fills this role via the PK MCP server.

## Architecture

```
                          ┌─────────────────┐
                          │  Orchestrator    │  (hosted or host mode)
                          │  global state    │  creates engagements,
                          │  pk-orchestrator │  assigns playbooks
                          └────────┬────────┘
                                   │ MCP tools
                    ┌──────────────┼──────────────┐
                    │              │              │
              ┌─────▼─────┐ ┌─────▼─────┐ ┌─────▼─────┐
              │ Engagement │ │ Engagement │ │ Engagement │
              │   Daemon   │ │   Daemon   │ │   Daemon   │
              │  (code)    │ │  (code)    │ │  (code)    │
              └─────┬──────┘ └───────────┘ └───────────┘
                    │
         ┌──────────┼──────────┐
         │          │          │
   ┌─────▼────┐ ┌──▼───┐ ┌───▼────────┐
   │Supervisor│ │Worker│ │Task Agents │
   │ (LLM)    │ │(exec)│ │(LLM, temp) │
   │persistent│ │      │ │per-action  │
   └──────────┘ └──────┘ └────────────┘
```

### Supervisor (per-engagement)

- One persistent Cartridge container per active engagement: `pk-sup-<slug>`
- Uses `pk-agent` image (same as task agents; future: lighter image without heavy tools)
- Spawned by daemon at engagement start, stopped at pause/done
- Reads SUPERVISOR.md (distinct from AGENT.md that task agents read)
- Has all PK MCP tools scoped to its engagement
- Watches engagement events via SSE/WS
- Can emit events (including `force: true` to re-run actions)
- Can adjust engagement phase, scope, targets
- Redirects stuck task agents by sending keystrokes to their terminal via the Cartridge API (same channel as xterm.js)
- Model is configurable (engagement setting or global default)
- Shows in the agent panel as "Supervisor" with a distinct indicator
- Its terminal is the default view when opening the agent panel on an engagement page

### Orchestrator (global)

- Single container: `pk-orchestrator` (hosted) or user's harness (host mode)
- In hosted mode: Cartridge container with PK MCP tools, global scope
- In host mode: Claude Code (or any harness) with PK MCP server
- Has PK MCP tools with global scope (all engagements)
- Can create engagements, assign playbooks, start/stop engagements
- Does NOT run tools or participate in engagements directly
- Shows in the agent panel outside any engagement section

### What gets removed

- `stall_detection` action from playbooks (replaced by the supervisor)
- Message inbox system (messages table, SSE stream, sendMessage/pollInbox)
  - The supervisor's terminal IS the communication channel
  - Human types in xterm.js, keystrokes go to Cartridge via WS
  - Clean up: remove inbox MCP tools, API routes, and any SPA references

**Note on naming:** The tiers were renamed after this spec was written. In the code examples below, "supervisor" refers to the daemon, "orchestrator" refers to the supervisor, and "controller" refers to the orchestrator. The architecture section above uses the current names.

## Detailed Design

### 1. ORCHESTRATOR.md

Lives at `packages/containers/agent/ORCHESTRATOR.md`. Copied into the container at `/workspace/ORCHESTRATOR.md` with a `CLAUDE.md` symlink (overrides AGENT.md for the orchestrator container).

Content covers:
- You are the orchestrator for engagement `$ENGAGEMENT_ID`
- Your job: watch progress, intervene when stuck, redirect agents
- You have the full PK MCP toolset
- You can emit events to trigger playbook actions (with force flag)
- You can send keystrokes to task agent terminals via the Cartridge API
- You can adjust engagement phase, scope, targets
- You do NOT run tools directly (the worker container does that)
- When you're stuck, ask the human (they see your terminal)

### 2. Supervisor changes

In `startSupervisor()`, after spawning the worker container:

```ts
// Spawn orchestrator container
const orchName = `pk-orch-${slug}`;
const orchContainer = await spawnOrchContainer(repo, opts.engagementId, orchImage, primaryTarget);
await waitForCartridge(orchName);
const orchAgentId = await startCartridgeAgent(orchName, orchestratorPrompt, provider, model);
// Register PTY alias
await registerAlias(orchAgentId, orchName, { action: "orchestrator", ... });
```

The orchestrator gets a dynamic prompt built from:
- Engagement name, type, scope, targets
- Current phase
- Recent discoveries summary (from context-builder)
- Number of active task agents
- Instruction: "Watch for events. Intervene when progress stalls."

On cleanup (engagement pause/done), stop the orchestrator container alongside the worker.

### 3. Agent panel changes

When on an engagement page, the panel shows:
```
HTB BEDSIDE
  ● Orchestrator                    orch   [connect by default]
  ● Toolbox (htb-bedside)          bedside [non-clickable]
  ○ Port Scanner                   abc123 [if running]

OTHER AGENTS
  ...
```

The orchestrator is auto-connected when opening the panel on an engagement page (no need to click). Its terminal streams live.

### 4. Cartridge keystroke API

The orchestrator redirects stuck agents by sending keystrokes to their terminal. The Cartridge API inside each agent container exposes:

```
POST /api/agents/:id/input
{ "data": "keystroke data" }
```

The orchestrator calls this via `curl` inside its container (or via the PK API proxy). This is the same mechanism the xterm.js frontend uses to type into a terminal.

### 5. Inbox removal

Remove from the codebase:
- `packages/api/src/routes/messages.ts` - the messages route
- References to `sendMessage`, `listMessages`, `pollInbox` in MCP server
- `subscribeMessages` SSE endpoint
- `messages` related code in SPA chat panel (already removed in earlier refactor)
- Keep the `messages` DB table for now (historical data), but remove API routes

### 6. PlaybookMeta addition

Add to `PlaybookMeta`:
```ts
orchestratorModel?: string;  // Model for the orchestrator (default: global config)
orchestratorPrompt?: string; // Custom initial prompt (default: built from template)
```

## Implementation Plan

### Phase 1: Orchestrator container (core)
1. Create `ORCHESTRATOR.md`
2. Update Dockerfile to copy it (separate from AGENT.md)
3. Add `spawnOrchContainer` to supervisor (reuses `spawnAgentContainer` with different name/prompt/md)
4. Supervisor lifecycle: spawn on start, stop on pause/done
5. Register PTY alias with action="orchestrator"

### Phase 2: Agent panel UX
1. Orchestrator shows first in panel with distinct styling
2. Auto-connect to orchestrator terminal when opening panel on engagement page
3. Worker stays non-clickable as "Toolbox"

### Phase 3: Inbox cleanup
1. Remove messages API routes
2. Remove messages MCP tools
3. Remove any remaining inbox references in SPA

### Phase 4: Controller (future, not this build)
1. Global Cartridge container `pk-controller`
2. MCP tools with global scope
3. Panel section outside engagement context

## Tech Stack

- Supervisor: TypeScript, runs in API process
- Orchestrator container: `pk-agent` Docker image with Cartridge
- Communication: Cartridge API (HTTP), PK MCP server, Postgres NOTIFY events
- Frontend: existing agent panel in SPA

## Boundaries

- **Always:** Orchestrator scoped to one engagement, never cross-engagement
- **Always:** Supervisor handles container lifecycle, orchestrator doesn't spawn/kill containers directly
- **Ask first:** Changing the Cartridge API contract, adding new MCP tools
- **Never:** Orchestrator running tools directly (that's the worker's job)
- **Never:** Controller in scope for this build (phase 4 is future)

## Success Criteria

1. Supervisor spawns `pk-orch-<slug>` container on engagement start
2. Orchestrator terminal streams live in the agent panel
3. Orchestrator receives engagement context and watches events
4. When stall fires, orchestrator analyzes and acts (emits events, adjusts phase)
5. Human can type into orchestrator terminal
6. Orchestrator can send keystrokes to task agent terminals
7. No message inbox references remain in active code paths
8. Resuming an engagement reconnects to existing orchestrator (doesn't spawn a new one)

## Open Questions

1. Should the orchestrator have a token/cost budget per engagement to prevent runaway spending?
2. Should the orchestrator's prompt be fully customizable per playbook, or just augmented?
3. The Cartridge keystroke API (`POST /api/agents/:id/input`) - does it exist already or do we need to add it?
