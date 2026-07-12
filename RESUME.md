# Resume: Reactive Playbooks

## Quick start

```
Just say: "Let's test the supervisor on a box" and paste an IP.
```

## What shipped last session (2026-07-12)

Massive session: 35 commits, designed + implemented the reactive playbook architecture.

### Architecture
- **Playbook SDK**: `Action` interface with run/prompt inference, `RunContext`, `createMockContext`
- **CTF playbook**: 21 actions (script/agent/both) replacing old 55-step PlaybookStep system
- **Pentest playbook**: phased with activate/drain/gate script
- **Supervisor**: event-driven Bun process, Postgres LISTEN/NOTIFY, WebSocket streaming
- **Execution modes**: race (5 concurrent), standard (3), methodical (1, gated), learning (1, pedagogical)
- **Exploit index**: 7 OKF cards in knowledge base (React2Shell, Log4Shell, PaperCut, etc.)
- **Events + discoveries DB**: events table with NOTIFY trigger, discoveries table, exec dedup

### Frontend
- Action graph at `/playbook` (react-flow, dagre layout)
- Mermaid export with copy button
- Simulation mode replaying Paperwork engagement
- Live mode via WebSocket from supervisor
- Click-to-open detail sidebar with xterm.js terminal

### Testing
- 40 tests passing (triggers, simulation, graph, mock context, e2e with mocked tool output)
- Old dead code deleted (blocks.ts, old playbooks, 485 lines)

### Docs
- 6 ADRs in `docs/decisions/`
- CLAUDE.md updated for supervisor architecture
- Supervisor README with WebSocket protocol
- SDK fully JSDoc'd

## What's next

### High priority (test on live engagement)

1. **Run supervisor on a real box.** Start an HTB machine, create engagement, run
   `pk supervisor <id>`. Watch the graph light up. Verify:
   - rustscan output parses into PortDiscovered events
   - whatweb/ffuf fire on HTTP ports
   - searchsploit + exploit index search runs on versions
   - LLM tasks arrive in inbox for orchestrator pickup

2. **Wire Cartridge API for LLM dispatch.** Currently `spawnLlm` sends to inbox;
   orchestrator manually spawns agents. Wire to Cartridge `POST /api/agents/run` so
   prompt-only actions dispatch automatically.

3. **Implement supervisor activate/drain/gate.** The pentest playbook script calls
   these but the supervisor doesn't implement them yet. Need:
   - `activate(actions)`: add actions to the active set
   - `deactivate(actions)`: remove from active set
   - `drain()`: wait until event queue empty + no running actions
   - `gate(message)`: send to inbox, pause until human responds

### Medium priority

4. **Graph layout polish.** Nodes overlap at high density. Try ELK layout or manual
   rank hints for phase grouping.
5. **xterm.js live output per action.** Terminal in sidebar shows placeholder; needs
   filtered WebSocket subscription per action name.
6. **Methodology.md update.** Still references old phase model.

## Key files

| Component | Path |
|-----------|------|
| SDK types | `packages/core/src/sdk.ts` |
| CTF playbook | `packages/core/src/actions/ctf.ts` |
| Pentest playbook | `packages/core/src/actions/pentest.ts` |
| Shared actions | `packages/core/src/actions/shared/` |
| Action graph | `packages/core/src/action-graph.ts` |
| Supervisor | `packages/supervisor/src/index.ts` |
| RunContext | `packages/supervisor/src/run-context.ts` |
| WebSocket | `packages/supervisor/src/ws-server.ts` |
| Frontend graph | `packages/web/src/app/playbook/page.tsx` |
| Tests | `packages/core/src/__tests__/` |
| ADRs | `docs/decisions/` |
| Spec | `docs/specs/reactive-playbooks.md` |
