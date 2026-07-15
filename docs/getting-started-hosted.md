# Getting started: hosted mode

Everything runs in Docker. Interact through the web UI or SSH into the orchestrator.

## Prerequisites

- Docker and Docker Compose

No local Node.js or AI agent required.

## Setup

```bash
npx @promptkiddie/init --mode hosted my-project
cd my-project
```

This starts all services including the web dashboard, API, and an orchestrator
container with the supervisor running in standby.

## Access

| Service | URL / command | Purpose |
|---------|--------------|---------|
| Web UI | http://localhost:3100 | Dashboard, chat, engagement management |
| SSH | `ssh -p 2222 root@localhost` | Direct CLI access to orchestrator |
| Terminal | http://localhost:7681 | Browser-based shell (ttyd) |
| API | http://localhost:3200 | REST API |

## First engagement

From the web UI, create an engagement and add targets. The supervisor picks it up
automatically and starts the playbook.

Or via SSH:

```bash
ssh -p 2222 root@localhost
pk engagement new --name "Box Name" --type ctf --scope "10.10.11.x"
pk target add --kind host --id 10.10.11.x --in-scope
```

## VPN

```bash
# Place .ovpn files in the vpn/ directory on the host
# Re-run init with --vpn, or add the linux-vpn profile manually:
docker compose --profile linux-vpn up -d
```

## Ports

All ports are configurable via `.env`:

| Variable | Default | Service |
|----------|---------|---------|
| `POSTGRES_PORT` | 5432 | Database |
| `PK_BROWSER_PORT` | 9222 | Chrome CDP |
| `PK_SSH_PORT` | 2222 | Orchestrator SSH |
| `PK_TTYD_PORT` | 7681 | Web terminal |
