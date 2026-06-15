# PromptKiddie

> An opinionated, AI-orchestrated workspace for ethical hacking: CTFs, white/black-box
> engagements, and bug bounty. Built-in methodology, evidence capture, and durable
> logging to PostgreSQL.

PromptKiddie turns an AI coding agent into an **offensive-security orchestrator**. The
main session plans and delegates to specialized sub-agents (recon, enumeration,
exploitation, reporting), runs tools, and writes every action, finding, and artifact to a
Postgres database so engagements are auditable and resumable. A web frontend (later
milestone) drives the orchestrator through a database-backed message inbox, so the agent can
run in the background while you steer from the browser.

## Why

Offensive work is methodical: recon → enumeration → exploitation → post-exploitation →
reporting. Doing it well means following a repeatable process, mapping findings to shared
frameworks (MITRE ATT&CK, OWASP, CVE/CVSS), capturing evidence as you go, and producing a
clean write-up. PromptKiddie bakes that discipline into the workspace itself.

## Status

**Milestone 1: Foundation + PostgreSQL logging.** This is what exists today:

- Orchestrator instructions (`CLAUDE.md`) and methodology docs (`docs/`)
- Skills and sub-agent definitions (`.claude/`)
- Engagement / Rules-of-Engagement / finding / report templates (`templates/`)
- PostgreSQL schema via Drizzle + `docker-compose` (`db/`, `packages/core`)
- `pk` CLI used to read/write the engagement database (`packages/cli`)

See [`docs/ROADMAP.md`](docs/ROADMAP.md) for what's next (web frontend, Kali MCP tooling).

## Quick start

```bash
# 1. Bring up Postgres (and Adminer on http://localhost:8080)
cp .env.example .env
docker compose up -d

# 2. Install deps and push the schema
pnpm install
pnpm db:push          # or: pnpm db:migrate

# 3. Build the CLI and create your first engagement
pnpm build
pk engagement new --name "HTB: Sherlock" --type ctf
pk engagement list
```

Then start an AI agent session in this repo; `CLAUDE.md` instructs the orchestrator on
how to run an engagement end to end.

## Supported engagement types

| Type        | Description                                                     |
| ----------- | --------------------------------------------------------------- |
| `ctf`       | Capture-the-flag boxes/challenges (HTB, THM, CTFd, etc.)        |
| `whitebox`  | Authorized assessment with source/architecture access          |
| `blackbox`  | Authorized assessment with no prior internal knowledge          |
| `bugbounty` | Public/private bug-bounty program within its defined scope      |

## Safety & authorization

PromptKiddie is for **authorized** security testing and education only. Every engagement
requires a Rules-of-Engagement record (scope, allowed actions, time windows). The
orchestrator is instructed to refuse to act outside the defined scope. See
[`docs/METHODOLOGY.md`](docs/METHODOLOGY.md) and `templates/rules-of-engagement.md`.
