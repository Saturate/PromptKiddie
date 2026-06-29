# PromptKiddie

AI-driven pentesting workspace. An orchestrator agent manages engagements, delegates to
phase-specific sub-agents, logs everything to PostgreSQL, and produces reports. You
interact through the web dashboard, the console chat, or the `pk` CLI.

Built for security professionals, CTF players, and red team researchers who want an AI
assistant that follows methodology, captures evidence, and doesn't hallucinate findings.

## What PK does

- Manages the full engagement lifecycle: scoping, recon, enumeration, exploitation,
  post-exploitation, reporting
- Runs security tools (nmap, rustscan, ffuf, nuclei, sqlmap, metasploit, impacket, ...)
  in isolated Docker containers
- Records targets, ports, findings, evidence (stored in DB with SHA-256 hashes), and
  activity in a structured database
- Detects stuck agents (repeated identical tool calls) and stops them
- Auto-parses nmap output to populate ports without relying on the agent
- Verifies findings adversarially before they reach the report
- Generates PDF reports from DB state via Typst
- Supports CTF objectives with flag capture tracking

## Quick start

```bash
cp .env.example .env
pnpm install
docker compose up -d        # postgres + attackbox
pnpm build
pnpm db:migrate
pnpm dev                    # web dashboard on localhost:3000
```

Open an AI agent session in this directory. `CLAUDE.md` instructs the orchestrator.

## Architecture

pnpm monorepo, seven packages:

| Package | What it does |
|---------|-------------|
| `core` | Drizzle schema, repo layer, embeddings, port parser |
| `cli` | `pk` command for engagement management and tool execution |
| `mcp-server` | 20+ MCP tools exposing the DB to AI agents |
| `tooling-mcp` | MCP bridge to run security tools inside containers |
| `tooling/images` | Phase-specific Docker images (base, recon, enum, exploit, full) |
| `web` | Next.js dashboard with console chat and engagement views |
| `api` | Hono REST server wrapping all repo functions |

## Docker setup

The attackbox is where security tools run. Five image variants:

| Image | Base | Tools | Use case |
|-------|------|-------|----------|
| `pk-full` | kali-rolling | Everything (338+ packages) | Default, kitchen sink |
| `pk-recon` | debian-slim | nmap, rustscan, httpx, whatweb, wafw00f, dig, whois | Recon phase |
| `pk-enum` | debian-slim | ffuf, gobuster, nikto, nuclei, enum4linux, smbclient, ldapsearch, seclists | Enumeration phase |
| `pk-exploit` | debian-slim | sqlmap, metasploit, john, hashcat, hydra, impacket, rustcat | Exploitation phase |
| `pk-base` | debian-slim | curl, python3, ssh, git, jq, netcat | Shared base layer |

Default setup uses the full image. Phase containers are opt-in:

```bash
docker compose up -d                              # full attackbox only
docker compose --profile phase-containers up -d    # + recon/enum/exploit containers
```

`pk exec` routes commands to the right container based on the current phase. If a tool
isn't available in the phase container, PK retries on the full attackbox automatically.

All containers include an exec logger that records every command to
`/workspace/.tool-log/exec.jsonl`, catching both `pk exec` calls and raw `docker exec`.

### VPN

For engagements behind a VPN (TryHackMe, Hack The Box):

```bash
# Place your .ovpn config in vpn/
pk vpn up       # starts OpenVPN in the attackbox
pk vpn status   # check connection + tun0 IP
pk vpn down     # disconnect
```

A headless Chrome container shares the attackbox network, so browser automation routes
through the VPN too. Configure the chrome-devtools MCP to connect to `localhost:9222`.

### Test targets

```bash
docker compose --profile targets up -d    # DVWA on :4280, Juice Shop on :4300
```

## pk CLI

All engagement state flows through the `pk` command:

```bash
pk engagement new --name "Corp Network" --type blackbox --scope "10.0.0.0/24"
pk engagement use <id>
pk target add --kind host --id 10.0.0.1 --in-scope
pk exec -- nmap -sV -sC 10.0.0.1        # auto-logs, auto-ingests ports
pk port list --target <id>               # ports populated from nmap output
pk finding add --title "SQLi on /login" --severity high \
  --exploit-scenario "POST user=admin' OR 1=1-- bypasses auth" \
  --source-ref "POST /login user param" --sink-ref "SQL query" \
  --confidence 0.9 --cvss-vector "CVSS:3.1/AV:N/AC:L/PR:N/UI:N/S:U/C:H/I:H/A:N"
pk finding update <id> --verdict true_positive --verdict-confidence 8
pk evidence add --path engagements/corp-network/exploit/sqli-proof.png --type screenshot
pk report generate                       # PDF via Typst
pk msg send --body "Recon complete, moving to enum"
```

Full command reference: `pk --help`

## Agent workflow

The orchestrator follows PTES methodology:

1. **Recon** - map the attack surface (ports, services, technologies)
2. **Enumeration** - deepen knowledge per service, find candidate vulnerabilities
3. **Exploitation** - validate findings with least-impact PoCs, capture evidence
4. **Verification** - adversarial review: assume each finding is wrong until proven
5. **Post-exploitation** - privesc, lateral movement, flag capture (if in scope)
6. **Reporting** - generate the deliverable from DB state

Each phase has a skill (`.claude/skills/`) that defines the procedure. The orchestrator
runs phases directly or delegates to sub-agents for context isolation.

## Observability

Langfuse integration for tracing LLM calls. Set keys in the web dashboard (Settings >
Observability) or via environment variables:

```bash
LANGFUSE_PUBLIC_KEY=pk-lf-...
LANGFUSE_SECRET_KEY=sk-lf-...
```

## Engagement types

| Type | Description |
|------|-------------|
| `ctf` | Capture-the-flag with objective/flag tracking |
| `whitebox` | Authorized assessment with source/architecture access |
| `blackbox` | Authorized assessment, no prior internal knowledge |
| `bugbounty` | Bug-bounty program within defined scope |

## Multi-harness support

PK works with different AI agent harnesses:

```bash
pk init --harness claude-code   # Claude Code (default)
pk init --harness opencode      # OpenCode
pk init --harness pi            # Pi.dev
```

The web dashboard's integrated chat works with Anthropic, OpenAI, Google, or custom
(Ollama) providers. Configure in Settings.

## Safety

PromptKiddie is for authorized security testing and education only. Every engagement
requires a Rules-of-Engagement record (scope, allowed actions, time windows). The
orchestrator refuses to act outside defined scope. See `docs/METHODOLOGY.md`.
