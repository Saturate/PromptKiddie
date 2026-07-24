# @promptkiddie/daemon

Event-driven process that watches engagement events via Postgres LISTEN/NOTIFY and dispatches playbook actions. Deterministic code, no LLM.

## Usage

Normally runs embedded in the API server, auto-starting per-engagement daemons when status changes to "active".

Standalone:

```bash
pk daemon <engagement-id>
pk daemon <engagement-id> --mode race    # max parallelism
pk daemon <engagement-id> --mode learning # human gates before LLM actions
```

## How it works

1. Connects to Postgres and `LISTEN pk_events`
2. Emits `EngagementStarted` to kick off the playbook
3. On each event: evaluates all action triggers, dispatches matches
4. Script actions (`run` field) execute via `docker exec` on the worker container
5. Prompt actions (`prompt` field) spawn agent containers with the task
6. Output streams to connected WebSocket clients

## Execution modes

| Mode | Concurrency | LLM dispatch | Use case |
|------|-------------|-------------|----------|
| race | 5 | Immediate | CTF competitions |
| standard | 3 | On trigger | Normal CTF, bug bounty |
| methodical | 1 | Queued until gate | Pentest, compliance |
| learning | 1 | Shows reasoning, waits for human | Practice |

## WebSocket protocol

Messages from daemon to client:

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
