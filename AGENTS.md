# Working in this repo

Monorepo for the PromptKiddie platform. pnpm workspaces, TypeScript for the platform, Rust for binaries that run on target machines.

## Packages

| Package | Language | What it is |
|---------|----------|------------|
| `core` | TS | Database schema (drizzle), engagement repo, playbook SDK, action graph |
| `cli` | TS | `pk` CLI that agents and supervisors use to read/write the engagement DB |
| `api` | TS | HTTP + WebSocket API + embedded daemon for the web UI |
| `spa` | TS/React | Dashboard SPA (Vite + React + TanStack Query + shadcn/ui) |
| `web` | TS/Next.js | Legacy Next.js UI (being replaced by spa) |
| `mcp-server` | TS | MCP server exposing engagement DB to Claude Code |
| `daemon` | TS | Event-driven process that runs playbook actions against targets |
| `tooling` | Docker | Attackbox container image with pentest tools |
| `gleipnir` | Rust | Persistent reverse shell handler (relay + agent binary) |
| `ratatosk` | Rust | Privilege escalation scanner (runs on target, outputs JSON) |
| `init` | TS | `pk init` workspace scaffolding |
| `containers` | Docker | Container definitions for phase-based agent isolation |

## Architecture

### Event-driven playbooks (Action SDK)

Playbooks are TypeScript modules exporting `Action[]`. Each action has:
- `on(event)` - trigger predicate evaluated against every event
- `run(ctx)` - script handler (auto-tier, runs tools directly)
- `prompt` - LLM task prompt (agent-tier, spawns a Cartridge agent)
- `emits` - event types this action may produce

The daemon evaluates actions against events. When `on()` returns true, the action fires. Script actions run tools via `ctx.exec()`. Agent actions spawn Docker containers with Cartridge + attack tools.

Built-in playbooks: `CTF_ACTIONS` (29 actions), `PENTEST_PLAYBOOK` (14 actions, phased with gates).

### Daemon

The daemon runs in standby mode embedded in the API process. It auto-starts per-engagement daemons when status changes to "active" and stops them on "paused"/"done".

Event propagation: events table -> Postgres NOTIFY trigger -> daemon event stream -> action dispatch.

### LLM tiers

Four tiers, from deterministic to full autonomy:

| Tier | Container | Scope | Lifecycle | Purpose |
|------|-----------|-------|-----------|---------|
| **Daemon** | (embedded in API) | per-engagement | auto start/stop | Deterministic code. Fires playbook actions on events. No LLM. |
| **Agent** | `pk-agent-<slug>-<id>` | per-action | spawned per prompt action, dies after | Short-lived LLM for one job: exploit this, analyze that. Reads AGENT.md. |
| **Supervisor** | `pk-sup-<slug>` | per-engagement | persistent while active | Persistent LLM. Watches events, intervenes on stalls, redirects stuck agents. Reads SUPERVISOR.md. |
| **Orchestrator** | `pk-orchestrator` | global | always-on (hosted) or host mode | Global LLM. Creates engagements, assigns playbooks, manages PK state. In host mode, the user's harness (Claude Code, etc.) fills this role via the PK MCP server. |

The daemon handles the deterministic playbook; the supervisor handles per-engagement judgment calls; the orchestrator handles platform-level decisions across engagements.

### Docker containers

Single unified image: `pk-agent` (all tools in one). Built from `packages/containers/agent/Dockerfile`.

Build: `pnpm build && docker build -t pk-agent -f packages/containers/agent/Dockerfile .`

Per-engagement containers spawned by the daemon:
- `pk-worker-<slug>` - persistent toolbox for `ctx.exec()`, runs `sleep infinity`
- `pk-sup-<slug>` - persistent supervisor with Cartridge + LLM
- `pk-agent-<slug>-<id>` - temporary task agents for prompt actions

Playbooks declare their image via `meta.image` (default: `pk-agent`). Individual actions can override with `action.image`.

### SPA (packages/spa)

Vite + React SPA at `packages/spa/`. Design system: amber accent (oklch 0.75 0.15 75), navy-indigo darks, monospace typography. Shared components in `components/pk/` (StatusDot, PhaseText, SeverityBadge, PageState, etc.).

Key pages: Dashboard, Engagements, EngagementDetail (with start/pause/stop controls), Playbooks (catalog + simulator), Status (system health), Knowledge (search).

Collapsible agent terminal panel on the right side connects to running containers via WebSocket PTY. The supervisor terminal is the default view on engagement pages.

## Scopes

Commit scopes match knope package names. Check `knope.toml` for the mapping. Common:

- `core`, `cli`, `api`, `spa`, `web`, `mcp-server`, `daemon`, `gleipnir`, `ratatosk`

## Changesets

Every PR that changes package functionality needs a changeset file in `.changeset/`.

```markdown
---
package-name: minor
---

One line describing what changed from a user perspective.
```

Use `minor` for features, `patch` for fixes.

## Building

```bash
pnpm install
pnpm build          # TypeScript compilation
pnpm dev            # SPA dev server (Vite, port 5173)
```

API server (includes embedded daemon):
```bash
source .env && export DATABASE_URL
pnpm --filter @promptkiddie/api start  # port 3200
```

Rust packages build independently:
```bash
cd packages/gleipnir && cargo build
cd packages/ratatosk && cargo build
```

## Database

Postgres via docker compose. Drizzle ORM with migration files in `db/migrations/`.

```bash
docker compose up -d postgres
pnpm db:migrate
```

## Testing

No global test command yet. Run per-package where tests exist. Rust packages use `cargo test`. The `core` package has the most coverage.

## Engagement vs dev

This repo serves two purposes: platform development and running engagements. The hooks, agent definitions, and CLAUDE.md for engagements are scaffolded by `pk init` into `.claude/settings.local.json` (gitignored). If you're doing dev work, you don't need to run `pk init`.

## Rust binaries

`gleipnir` and `ratatosk` cross-compile for Linux (musl, static) and Windows (gnu). CI builds are triggered by knope releases, not by pushes. Use `cross` for local cross-compilation:

```bash
cargo install cross
cross build --release --target x86_64-unknown-linux-musl
```
