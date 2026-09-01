# ADR-0004 — Transactional Outbox

**Status:** Accepted
**Date:** 2026-09-01

## Context

Core database changes must not depend on a queue or external provider being available, and a process crash between a database commit and publication must not silently lose a side effect.

## Decision

Persist an `OutboxEvent` in the same PostgreSQL transaction as its originating application mutation. A lease-based dispatcher claims the event, resolves a versioned route, and enqueues a provider-neutral delivery job with a deterministic deduplication key. It marks the outbox event `PROCESSED` only after durable queue acceptance.

The worker handles delivery with bounded retries. Before calling a consumer, it inserts `OutboxConsumerReceipt` using conflict-safe semantics inside the same transaction as the consumer effect. A duplicate receipt skips the consumer; a consumer failure rolls the receipt and effect back together.

`PROCESSED` means handed to the durable queue. Consumer completion is represented by the receipt and queue terminal state.

## Alternatives Considered

- Publish after commit in the request process: rejected because a crash loses the event.
- Distributed transactions with providers: rejected because providers do not share the database transaction.
- At-most-once delivery: rejected because losing critical side effects is unacceptable.

## Consequences

- Delivery is at least once; consumers must be idempotent.
- Failed queue jobs and outbox events remain persisted for operations and future replay tooling.
- Adding multiple consumers for one event will require explicit fan-out delivery records rather than changing the meaning of the current receipt.

## Security / Data Impact

Payloads must not contain plaintext secrets. Organization, correlation, and causation metadata are preserved. Errors stored for retry are bounded and sanitized.

## Migration / Rollback

The Sprint 01 technical migration creates queue, outbox, and receipt tables. Removing them is destructive and requires supervisor approval after all pending work is reconciled.

## References

- `packages/outbox/src/outbox-writer.ts`
- `packages/outbox/src/outbox-dispatcher.ts`
- `packages/outbox/src/outbox-delivery.job.ts`
- `docs/engineering/SPRINT_01_FOUNDATION_GUIDE.md`
