# Architecture

PromptKiddie has three layers: an **orchestration** layer (AI agent), a **persistence**
layer (PostgreSQL), and a **tooling** layer (offensive tools, eventually behind an MCP).
A web frontend sits on top of persistence for human control.

```mermaid
graph TD
    FE["Web Frontend<br/><small>Next.js: dashboards + chat inbox</small><br/><small>(Milestone 2)</small>"]
    ORCH["Agent Orchestrator<br/><small>plans engagement, polls inbox,<br/>delegates to sub-agents,<br/>logs via pk</small>"]
    PG["PostgreSQL<br/><small>engagements, targets, findings,<br/>evidence, activity_log,<br/>agent_runs, messages</small>"]
    SUB["Sub-agents<br/><small>recon, enum, exploit, report</small>"]
    TOOLS["Tooling layer<br/><small>nmap, ffuf, nuclei, sqlmap<br/>Bash today; Kali MCP later (M3)</small>"]

    FE -- reads/writes --> PG
    ORCH <-- pk CLI / packages/core --> PG
    ORCH -- spawns --> SUB
    SUB -- findings/activity/evidence --> PG
    SUB -- run tools --> TOOLS
```

## Orchestration layer

The **main session is the Orchestrator**. It does not do the grunt work itself; it:

1. Loads the active engagement and its Rules of Engagement (RoE).
2. Decides which methodology phase to run next (see `METHODOLOGY.md`).
3. Delegates a scoped task to a **sub-agent** (recon/enum/exploit/report), or when a
   sub-agent would be overkill, runs a single tool directly via Bash and logs it.
4. Persists results through the `pk` CLI / `packages/core` API.
5. Polls the `messages` inbox for human input and replies there, so the whole thing can run
   in the background while you drive from the frontend.

### Skills are primary; sub-agents are optional

**Skills** (`.claude/skills/`) are the heart of the workspace: the reusable, opinionated
*playbooks* for how to run recon, enumerate, exploit, capture evidence, and report. They
carry the methodology and are injected into whichever context needs them.

**Sub-agents** (`.claude/agents/`) are thin wrappers, not where the value lives. A sub-agent
exists only to give the orchestrator **context isolation** (a huge scan dump doesn't flood
the main session) and **parallelism**. Each one essentially says "follow skill X for this
phase and report back." When isolation isn't needed, the orchestrator runs the phase itself
using the skill directly, no sub-agent required.

### Why an inbox instead of `-p`

The orchestrator runs as a normal interactive AI agent session. To let a human steer a
backgrounded session, control flows through the `messages` table:

- The frontend (or `pk msg send`) inserts an `inbound` row.
- The orchestrator polls (`pk msg poll`) for `new` inbound messages, acts, and writes an
  `outbound` reply.
- Everything is durable and auditable. The conversation is part of the engagement record.

A Postgres `LISTEN/NOTIFY` channel can replace polling later for lower latency.

## Persistence layer (PostgreSQL + Drizzle)

A single Postgres database is the source of truth for an engagement. Schema lives in
`packages/core/src/schema.ts` (Drizzle ORM, `node-postgres` driver). Core entities:

| Table          | Purpose                                                                 |
| -------------- | ----------------------------------------------------------------------- |
| `engagements`  | One per CTF/assessment/program. Holds type, status, scope, RoE.         |
| `targets`      | Hosts/domains/URLs/apps/repos within an engagement, with in-scope flag. |
| `findings`     | Vulnerabilities/flags with severity, CVSS, OWASP/ATT&CK/CVE mappings.   |
| `evidence`     | Files/screenshots/scan output, hashed (sha256) and linked to findings.  |
| `activity_log` | Append-only audit trail: every command/action the orchestrator takes.   |
| `agent_runs`   | One row per sub-agent invocation: agent, phase, status, summary.         |
| `messages`     | Bidirectional human↔orchestrator inbox driving background operation.    |

Disk artifacts (raw scan output, screenshots, downloaded files) live under
`engagements/<slug>/` and are referenced by path + hash from the `evidence` table. Engagement
data is **gitignored**. Never commit client/target data.

### Two ways to write the DB: CLI now, MCP next

All persistence goes through one core library (`packages/core`). Two front-ends sit on top:

- **`pk` CLI** (`packages/cli`): shell commands the orchestrator/sub-agents run today.
  Easy to script, human-friendly.
- **Logging MCP server** (planned): wraps the *same* core functions as structured MCP
  tools (`add_finding`, `log_activity`, …) for type-safe, tool-native logging.

Because both call the same core, behavior stays identical no matter which is used.

## Tooling layer

Today: the orchestrator and sub-agents invoke tools via Bash (assumes a Kali-like host).

Milestone 3: a **Dockerized Kali MCP server** exposes a curated toolset (nmap, ffuf,
nuclei, sqlmap, gobuster, etc.) as structured MCP tools, giving reproducible, isolated,
portable tooling and clean structured output that maps straight into `findings`/`evidence`.

## Frameworks

Findings are tagged against shared frameworks so reports are standard and comparable:

- **MITRE ATT&CK**: technique IDs (e.g. `T1190`) on findings/activity.
- **OWASP**: Top 10 / WSTG / ASVS references for web findings.
- **CVE + CVSS**: known-vuln identifiers and severity scoring.

See `docs/frameworks/` for cheat-sheets and the canonical mappings.
