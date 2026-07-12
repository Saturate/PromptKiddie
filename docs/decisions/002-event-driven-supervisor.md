# ADR-002: Event-driven supervisor over phase waterfall

**Status**: accepted
**Date**: 2026-07-12

## Context

Engagement data across three CTF boxes showed 80-85% of recon LLM tokens wasted on
mechanical steps (port scanning, web fingerprinting, directory brute-force). The phase
waterfall model serialized work that could run in parallel: exploitation waited for
enumeration to "complete," even when a critical vulnerability was found in the first
minute.

## Decision

Replace the phase-based waterfall with an event-driven supervisor. Automated tools
produce structured events (PortDiscovered, VersionIdentified). Actions fire when their
trigger conditions match. The supervisor is a code process (not an LLM) that dispatches
work with zero latency via Postgres LISTEN/NOTIFY.

Phase gates are optional, controlled by execution mode: CTF mode is fully reactive;
pentest mode uses activate/drain/gate for phased execution with human approval.

## Alternatives considered

- **Keep phases, add parallelism within each**: still serializes across phases. A critical
  finding in minute 2 waits for the recon phase to "complete."
- **Polling-based supervisor**: Barracks pattern (30s poll). Too slow for machine-speed
  events; rustscan finishes and 20 port events need processing immediately.

## Consequences

- Auto-tier actions (scripted scans) run with zero LLM involvement.
- LLM tokens are spent only on judgment tasks (source code analysis, exploitation).
- The orchestrator LLM becomes the human's interface and safety net, not the hot-path
  dispatcher.
- Event replay and the discoveries table give agents structured context instead of raw
  tool output.
- Phased pentest mode requires the activate/drain/gate pattern (implemented but not yet
  tested on a real engagement).
