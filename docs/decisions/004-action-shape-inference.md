# ADR-004: Action shape inference (run/prompt, no explicit tier)

**Status**: accepted
**Date**: 2026-07-12

## Context

Early SDK iterations had a `tier` field ("auto" | "llm" | "both") and later a `runner`
field. Both added a declaration that duplicated what the presence of `run` and `prompt`
fields already implied.

## Decision

The action's execution mode is inferred from which fields are present:
- `run` only = script (supervisor calls directly)
- `prompt` only = agent (supervisor sends to Cartridge)
- Both = script first, then agent

No explicit tier/runner field. The `llm` field is an optional config object (agent type,
model, priority, session strategy) that only applies when `prompt` is set.

## Consequences

- Simpler API: fewer fields to set, less documentation to read.
- LLM-tier actions require zero TypeScript: just `on` trigger + `prompt` string.
- The graph builder infers node kind ("script" | "agent" | "both") for visualization.
- Validation is implicit: an action with neither `run` nor `prompt` does nothing.
