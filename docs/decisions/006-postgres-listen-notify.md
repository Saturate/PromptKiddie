# ADR-006: Postgres LISTEN/NOTIFY over polling

**Status**: accepted
**Date**: 2026-07-12

## Context

The supervisor needs to react to events as they're written to the database. Two options:
poll the events table on an interval, or use Postgres LISTEN/NOTIFY for push-based
delivery.

## Decision

Use Postgres LISTEN/NOTIFY. A trigger on the `events` table fires `pg_notify('pk_events',
...)` on every INSERT. The supervisor `LISTEN`s on the channel and reacts immediately.

## Alternatives considered

- **Polling at N seconds**: Barracks uses 30s polling for human-speed task creation. PK's
  supervisor watches machine-speed events; rustscan finishes and 20 port events need
  processing immediately. Any polling interval either wastes resources (1s) or adds
  latency (30s).
- **External message queue (Redis, NATS)**: adds infrastructure. Postgres is already the
  database; LISTEN/NOTIFY is built in with zero additional dependencies.

## Consequences

- Zero latency between event INSERT and supervisor reaction.
- No polling loop, no wasted cycles checking empty tables.
- Stall detection is a simple timer reset: if no NOTIFY arrives in N minutes, fire the
  freestyle rule.
- The supervisor must maintain a persistent Postgres connection (Client, not Pool).
  Reconnection on disconnect is the supervisor's responsibility.
- LISTEN is per-connection; multiple supervisor instances on the same channel receive
  duplicate notifications. The supervisor filters by engagement_id.
