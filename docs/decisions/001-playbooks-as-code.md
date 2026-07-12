# ADR-001: Playbooks as code, not YAML

**Status**: accepted
**Date**: 2026-07-12

## Context

The reactive playbooks spec initially defined rules as YAML with trigger expressions,
command templates, and side-effect declarations. During design review, we recognized this
was encoding program logic (conditionals, loops, error handling) in a config format.

## Decision

Playbooks are TypeScript modules exporting `Action[]`. Each action has an `on` trigger
function, an optional `run` handler, and an optional `prompt` string. Shared steps are
regular function imports. No YAML, no custom expression language, no template system.

This is the pattern where config formats gradually acquire conditionals, variables, and
error handling until they become a worse version of the programming language they were
trying to avoid. We chose to skip that progression and use TypeScript directly.

## Alternatives considered

- **YAML rules with CEL triggers**: cleaner for simple cases, but needs a custom evaluator,
  template variable resolution, and auto->LLM sequencing. Each of these is a partial
  reimplementation of what TypeScript provides natively.
- **Hybrid (YAML for simple, code for complex)**: two authoring surfaces to maintain and
  document. Complexity budget spent on glue instead of features.

## Consequences

- Playbooks are type-checked, testable with vitest, and debuggable with breakpoints.
- LLMs writing playbooks need to produce TypeScript, not fill YAML schemas. The SDK JSDoc
  serves as the interface.
- The react-flow graph visualization is derived from code (static analysis of emits/triggers),
  not authored in a GUI.
- Non-developers can't edit playbooks without writing TypeScript. Acceptable because playbook
  authors are operators building PK, not end users.
