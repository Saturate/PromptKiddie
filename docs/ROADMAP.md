# Roadmap

PromptKiddie is built in milestones. Each is independently useful.

## ✅ Milestone 1: Foundation + PostgreSQL logging  *(current)*

The opinionated workspace + durable engagement logging.

- [x] Orchestrator instructions (`CLAUDE.md`) and methodology/architecture docs
- [x] Skills: recon, enumeration, exploitation, evidence-logging, reporting
- [x] Sub-agents: recon / enum / exploit / report
- [x] Templates: Rules of Engagement, engagement, finding, report
- [x] PostgreSQL via `docker-compose` (Postgres + Adminer)
- [x] Drizzle schema: engagements, targets, findings, evidence, activity_log, agent_runs, messages
- [x] `packages/core`: DB client + logging/inbox API
- [x] `packages/cli`: `pk` command the orchestrator uses to read/write the DB
- [x] SessionStart hook so agent sessions can boot the DB + deps
- [x] Evidence-on-disk conventions (`engagements/`, gitignored)

**Definition of done:** start a session, create an engagement, run a phase, and have every
action/finding/artifact persisted and queryable via `pk`.

> Note: skills are the centerpiece of M1; the four sub-agents are thin, optional wrappers
> around them (for context isolation / parallelism), not load-bearing.

## ✅ Milestone 1.5: Logging MCP server

Wrap `packages/core` as a local MCP server so the orchestrator can log via structured tools
(`add_finding`, `log_activity`, `add_evidence`, …) in addition to the `pk` CLI. Same core,
same behavior, just a tool-native interface.

- [x] MCP server exposing core logging/inbox functions as tools (19 tools)
- [x] Wire into `.mcp.json` so a session picks it up automatically

## ✅ Milestone 2: Web frontend + background operation

Drive a backgrounded orchestrator from the browser.

- [x] Next.js app: engagement dashboard, findings board, activity timeline, evidence viewer
- [x] Create engagement from the UI (name + type, redirects to detail page)
- [x] Chat inbox UI backed by the `messages` table (the human/orchestrator channel)
- [x] Auto-polling inbox (3s interval) for live message updates
- [x] Live phase indicator (derived from latest activity log entry)
- [ ] Optional Postgres `LISTEN/NOTIFY` for lower-latency message delivery

## 🔜 Milestone 3: Tooling layer

Reproducible, isolated offensive tooling as structured MCP tools.

- [x] Dockerized Debian image with nmap, ffuf, nuclei, sqlmap, gobuster, nikto, httpx
- [x] MCP server (10 tools) running commands via `docker exec`, wired into `.mcp.json`
- [x] docker-compose service with workspace volume mount
- [x] Structured tool output parsers (nmap XML to hosts/ports JSON, nuclei JSONL to findings)
- [ ] Per-engagement network isolation + scope enforcement at the tooling boundary

## 🧭 Later / backlog

- [ ] Multi-provider model config
- [ ] Framework data packs: ATT&CK navigator export, OWASP WSTG checklist automation
- [ ] Report rendering to PDF/HTML from the DB
- [ ] Retest workflow (link findings across engagements, track remediation)
- [ ] Bug-bounty program importer (scope + policy ingestion)
- [ ] CTF platform adapters (HTB/THM metadata sync)
