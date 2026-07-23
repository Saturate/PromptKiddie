# Getting started: host mode

Run PK infrastructure in Docker, your AI agent on your machine.

## Prerequisites

- Docker and Docker Compose
- Node.js 18+
- An AI coding agent: Claude Code, Codex, OpenCode, or similar

## Setup

```bash
npx @promptkiddie/init my-project
cd my-project
```

The init script scaffolds `docker-compose.yml`, `.env`, `AGENTS.md`, and starts
Postgres, headless Chrome, and Gleipnir.

## First engagement

Open the project directory in your AI agent. The agent reads `AGENTS.md` (or
`CLAUDE.md`, which symlinks to it) for supervisor instructions.

```bash
pk engagement new --name "Box Name" --type ctf --scope "10.10.11.x"
pk target add --kind host --id 10.10.11.x --in-scope
pk daemon <engagement-id>
```

The daemon handles the rest: port scanning, web recon, directory brute-forcing,
CVE matching, and spawning exploit agents.

## VPN (Hack The Box / TryHackMe)

```bash
# Place your .ovpn config in vpn/
pk vpn up
pk vpn status
```

## What's running

| Service | Port | Purpose |
|---------|------|---------|
| Postgres | 5432 | Engagement database |
| Chrome | 9222 | Browser automation (CDP) |
| Gleipnir | 4444 | Reverse shell relay |
