# ADR-003: Supervisor in Node/Bun, not Rust

**Status**: accepted
**Date**: 2026-07-12

## Context

The reactive playbooks spec initially specified the supervisor as a Rust binary (aligning
with the pk-rs CLI rewrite). During adversarial review, we identified that playbook
actions are TypeScript functions. A Rust supervisor would need an embedded JS runtime
(deno_core) to evaluate triggers and run action handlers.

## Decision

The supervisor is a Node/Bun process. Action triggers and handlers execute natively.
The pk-rs Rust binary remains the CLI; the supervisor is a separate long-running process.

## Alternatives considered

- **Rust with deno_core**: adds ~15MB binary size and complex FFI for the RunContext bridge.
  Every `ctx.exec()` call crosses the Rust/JS boundary.
- **Compile actions to a protocol**: Rust supervisor sends events to a TS sidecar via
  JSON-RPC. Clean separation but adds a network hop per event and the sidecar is the
  actual brain.

## Consequences

- Actions run natively; no serialization boundary for trigger evaluation.
- Hot reloading is possible via `import()` with cache busting.
- The supervisor shares the same `@promptkiddie/core` package as the CLI and web server.
- If performance becomes an issue (unlikely; the bottleneck is tool execution, not dispatch),
  the Rust path remains available via deno_core.
