<p align="center">
  <img src="assets/icon.png" width="128" height="128" style="image-rendering: pixelated;" alt="PromptKiddie">
</p>

<h1 align="center">PromptKiddie</h1>

<p align="center">
  <em>LLM Powered Automated Hacking Playbooks.</em>
</p>

<p align="center">
  An autonomous supervisor that scans, enumerates, and escalates while you steer.<br>
  You set the scope; PK handles the methodology, evidence, and reporting.
</p>

<p align="center">
    You can work from the web interface, or directly in your favorite harness, or the CLI if your that kind of kiddo. Script our own playbooks with the provided SDK. 
</p>

---

**Key features:**

- **Event-driven playbooks.** Write playbooks that reacts on events, trigger a automated portscan on engagement start, and act on the findings programaticlly or delegate to an agent.
- **Judgment stays with the LLM, mechanics don't.** Port scanning, fingerprinting,
  and directory brute-forcing are scripted actions. The LLM only gets called for
  decisions that need reasoning: exploit selection, source code analysis, privesc
  path planning.
- **Everything in a database.** Targets, ports, services, findings, evidence,
  credentials, flags, activity log. Nothing lives only in chat history. Reports
  generate from DB state, not from some LLM memory.
- **Multi-harness.** Works with any harness; Claude Code, Codex, OpenCode, Pi.dev, or the built-in web
  chat via Vercel AI SDK.

## Quick start

```bash
cp .env.example .env          # set DATABASE_URL
pnpm install && pnpm build
docker compose up -d           # postgres + tooling containers
pnpm db:migrate
pnpm dev                       # web dashboard on localhost:3000
```

Then in your AI agent session:

```bash
pk engagement new --name "Box Name" --type ctf --scope "10.10.11.x"
pk target add --kind host --id 10.10.11.x --in-scope
pk supervisor <engagement-id>  # starts the reactive playbook
```

The supervisor takes it from here. Watch progress at `localhost:3000/playbook`.

## How it works

```
You (scope + steer)
  |
  v
Orchestrator (AI session)
  |
  ├── pk supervisor ──> Event-driven playbook
  |     port_scan ──> web_recon ──> dir_brute ──> cve_search ──> exploit
  |     Each arrow is an event (PortDiscovered, VersionIdentified, ...)
  |
  ├── pk spawn agent ──> Isolated containers with attack tools
  |
  ├── pk shell / pk tunnel ──> Gleipnir (persistent reverse shells + SOCKS)
  |
  ├── ratatosk ──> Fast privesc scanner (Rust, runs on target, JSON output)
  |
  └── pk msg ──> Inbox (human-agent communication)
```

## Engagement types

| Type | Use case |
|------|----------|
| `ctf` | Hack The Box, TryHackMe, Proving Grounds. Flag tracking + auto-phase. |
| `blackbox` | Authorized pentest, no prior knowledge. Phase-gated methodology. |
| `whitebox` | Source access, architecture docs. Deeper analysis actions. |
| `bugbounty` | Scoped bug bounty. Respects rate limits and exclusions. |

## Knowledge base

PK ships exploits and techniques as structured knowledge in [OKF](https://cloud.google.com/blog/products/data-analytics/how-the-open-knowledge-format-can-improve-data-sharing) format. The supervisor auto-matches discovered versions against the exploit index and fires when it finds a hit. Sources include HackTricks and GTFOBins.

## Documentation

- [Getting started: host mode](docs/getting-started-host.md) - AI agent runs locally, infra in Docker
- [Getting started: hosted mode](docs/getting-started-hosted.md) - everything in Docker, web UI + SSH
- [Methodology](docs/METHODOLOGY.md) - phased process and rules of engagement
- [Architecture](docs/ARCHITECTURE.md) - how the pieces fit together
- [AGENTS.md](AGENTS.md) - repo structure, package scopes, build and contribution guide

## Safety

For authorized testing, CTFs, and education only. Every engagement requires a
Rules-of-Engagement record with scope, allowed actions, and time windows. The
orchestrator refuses to act outside defined scope.

LLMs with access to live machines and networks can be quite dangerous. Use at your own risk.
