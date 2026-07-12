# Supervisor

Event-driven process that watches engagement events via Postgres LISTEN/NOTIFY
and dispatches playbook actions. Not an LLM; pure code.

## Usage

```bash
pk supervisor <engagement-id>
pk supervisor <engagement-id> --mode race    # max parallelism
pk supervisor <engagement-id> --mode learning # human gates before LLM actions
```

Or directly:

```bash
pnpm --filter @promptkiddie/supervisor start -- <engagement-id>
```

## How it works

1. Connects to Postgres and `LISTEN pk_events`
2. Emits `EngagementStarted` to kick off the playbook
3. On each event: evaluates all action triggers, dispatches matches
4. Script actions (`run` field) execute via `docker exec` on the attackbox
5. Prompt actions (`prompt` field) send the task to the orchestrator inbox
6. Output streams to connected WebSocket clients on port 3200

## Execution modes

| Mode | Concurrency | LLM dispatch | Use case |
|------|-------------|-------------|----------|
| race | 5 | Immediate | CTF competitions |
| standard | 3 | On trigger | Normal CTF, bug bounty |
| methodical | 1 | Queued until gate | Pentest, compliance |
| learning | 1 | Shows reasoning, waits for human | Practice |

## WebSocket protocol

Connects on `ws://localhost:3200` (configurable via `PK_WS_PORT`).

Messages from supervisor to client:

```json
{ "type": "event", "data": { "type": "PortDiscovered", "payload": {...} } }
{ "type": "action_start", "data": { "name": "port_scan" } }
{ "type": "action_end", "data": { "name": "port_scan" } }
{ "type": "output", "data": { "action": "port_scan", "line": "80/tcp open http" } }
```

## Environment

- `DATABASE_URL` - Postgres connection string
- `PK_WS_PORT` - WebSocket server port (default: 3200)
- `PK_ATTACKBOX` - Docker container name (default: promptkiddie-attackbox)
