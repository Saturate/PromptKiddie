# Working in this repo

Monorepo for the PromptKiddie platform. pnpm workspaces, TypeScript for the platform, Rust for binaries that run on target machines.

## Packages

| Package | Language | What it is |
|---------|----------|------------|
| `core` | TS | Database schema (drizzle), engagement repo, playbook SDK, action graph |
| `cli` | TS | `pk` CLI that agents and orchestrator use to read/write the engagement DB |
| `api` | TS | HTTP + WebSocket API for the web UI |
| `web` | TS/Next.js | Dashboard UI (engagements, playbook graph, findings) |
| `mcp-server` | TS | MCP server exposing engagement DB to Claude Code |
| `supervisor` | TS | Event-driven process that runs playbook actions against targets |
| `tooling` | Docker | Attackbox container image with pentest tools |
| `tooling-mcp` | TS | MCP server wrapping nmap, ffuf, nuclei, etc. |
| `gleipnir` | Rust | Persistent reverse shell handler (relay + agent binary) |
| `ratatosk` | Rust | Privilege escalation scanner (runs on target, outputs JSON) |
| `init` | TS | `pk init` workspace scaffolding |
| `containers` | Docker | Container definitions for phase-based agent isolation |

## Scopes

Commit scopes match knope package names. Check `knope.toml` for the mapping. Common:

- `core`, `cli`, `api`, `web`, `mcp-server`, `supervisor`, `gleipnir`, `ratatosk`
- `tooling-mcp` also covers `tooling` and `vpn` changes

## Changesets

Every PR that changes package functionality needs a changeset file in `.changeset/`. Without one, the release workflow has nothing to consume.

```markdown
---
package-name: minor
---

One line describing what changed from a user perspective.
```

Use `minor` for features, `patch` for fixes. The package name must match a `[packages.*]` key in `knope.toml`.

## Building

```bash
pnpm install
pnpm build          # TypeScript compilation
pnpm dev            # Next.js dev server (web UI)
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
