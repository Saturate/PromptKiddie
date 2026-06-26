# PromptKiddie

AI-orchestrated ethical-hacking workspace. Engagements, findings, evidence, and activity
are logged to PostgreSQL. A web dashboard and Docker-based tooling container handle the
operational side; Claude Code acts as the orchestrator.

## Architecture

pnpm monorepo with six packages:

| Package | Purpose |
|---------|---------|
| `core` | Drizzle DB schema and repository layer |
| `cli` | `pk` command for engagement management |
| `mcp-server` | MCP tools that expose the DB to Claude Code |
| `tooling` | Kali-based Docker image with 15+ security tools |
| `tooling-mcp` | MCP bridge to run tools inside the container |
| `web` | Next.js dashboard for engagements, findings, and inbox |

Infrastructure runs via `docker-compose`: PostgreSQL, the tooling container (with VPN
and security tools), and an Adminer instance for DB access.

## Quick start

```bash
cp .env.example .env
pnpm install
docker compose up -d
pnpm build
pnpm db:migrate
pnpm dev
```

Then open an AI agent session in this repo. `CLAUDE.md` instructs the orchestrator on how
to run engagements end to end.

## pk CLI

All engagement state flows through the `pk` command.

**Engagement lifecycle:**
`pk engagement new|list|use|show|status|delete`

**Targets:**
`pk target add|list|update`

**Findings:**
`pk finding add|list|update`

**Evidence:**
`pk evidence add|list`

**Objectives and artifacts:**
`pk objective add|list|update` / `pk artifact add|list`

**Activity log:**
`pk activity log|list`

**Agent runs:**
`pk agent start|finish`

**Inbox:**
`pk msg send|poll`

**Tool execution:**
`pk exec <tool> [args]` (auto-logs to activity)

**Search:**
`pk search <query>`

**VPN:**
`pk vpn up|down|status`

**Reports:**
`pk report generate` (produces PDF via Typst)

**Reasoning:**
`pk think "<note>"` (shows in the Agent Log tab)

## VPN setup

For engagements behind a VPN (TryHackMe, Hack The Box, etc.):

1. Place your `.ovpn` config file in the `vpn/` directory at the project root.
2. Run `pk vpn up` to start OpenVPN inside the tooling container.
3. Verify with `pk vpn status` (prints connection state and tun0 IP).
4. Stop with `pk vpn down` when finished.

The `vpn/` directory is mounted read-only to the container at `/vpn`. Override the mount
path by setting `PK_VPN_CONFIG` in `.env`.

## Docker architecture

`docker-compose.yml` defines three services:

- **postgres** (PostgreSQL 17): engagement database
- **tooling** (Kali-based): nmap, rustscan, nikto, nuclei, ffuf, gobuster, sqlmap, httpx,
  dig, whois, and more. Runs OpenVPN for VPN-backed engagements. Has `NET_RAW`,
  `NET_ADMIN` capabilities and `/dev/net/tun` access.
- **adminer**: browser-based DB admin on port 8080

Optional test targets (enabled with `--profile targets`): DVWA on port 4280 and
Juice Shop on port 4300.

## Agent workflow

The orchestrator (Claude Code, guided by `CLAUDE.md`) follows a phased methodology:

1. **Recon** -- map the attack surface (DNS, subdomains, ports, services)
2. **Enumeration** -- deepen knowledge per service, triage candidate vulnerabilities
3. **Exploitation** -- validate findings with least-impact PoCs, capture evidence
4. **Post-exploitation** -- privesc, lateral movement, flag capture (if in scope)
5. **Reporting** -- generate the deliverable from DB state

Each phase has a skill (`.claude/skills/`) and an optional sub-agent
(`.claude/agents/`). The orchestrator runs phases directly or delegates to sub-agents
for context isolation and parallelism.

## Report generation

`pk report generate` pulls findings, evidence, and activity from the database, renders a
Typst template, and produces a PDF. The web dashboard also exposes a download button.

## Engagement types

| Type | Description |
|------|-------------|
| `ctf` | Capture-the-flag (HTB, THM, CTFd) |
| `whitebox` | Authorized assessment with source/architecture access |
| `blackbox` | Authorized assessment, no prior internal knowledge |
| `bugbounty` | Bug-bounty program within its defined scope |

## Safety

PromptKiddie is for authorized security testing and education only. Every engagement
requires a Rules-of-Engagement record (scope, allowed actions, time windows). The
orchestrator refuses to act outside defined scope. See `docs/METHODOLOGY.md`.
