# Architecture Decision Records

Lightweight records of significant technical decisions. Each captures what was decided,
why, what alternatives were considered, and consequences.

Specs (`docs/specs/`, gitignored) are working design documents that may contain engagement
data. When a spec is implemented, the architectural decisions are extracted here in
sanitized form. The spec is then deleted.

## Format

```markdown
# ADR-NNN: Title

**Status**: proposed | accepted | superseded by ADR-XXX
**Date**: YYYY-MM-DD

## Context
What prompted this decision.

## Decision
What we chose.

## Alternatives considered
What else we looked at and why we didn't pick it.

## Consequences
What changes as a result. Both positive and negative.
```

## Index

| ADR | Title | Status |
|-----|-------|--------|
| [001](001-playbooks-as-code.md) | Playbooks as code, not YAML | accepted |
| [002](002-event-driven-supervisor.md) | Event-driven supervisor over phase waterfall | accepted |
| [003](003-supervisor-in-node.md) | Supervisor in Node/Bun, not Rust | accepted |
| [004](004-action-shape-inference.md) | Action shape inference (run/prompt, no tier) | accepted |
| [005](005-exploit-cards-in-knowledge.md) | Exploit cards in knowledge base, not separate index | accepted |
| [006](006-postgres-listen-notify.md) | Postgres LISTEN/NOTIFY over polling | accepted |
