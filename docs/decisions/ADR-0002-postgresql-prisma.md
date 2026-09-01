# ADR-0002 — PostgreSQL and Prisma

**Status:** Accepted
**Date:** 2026-09-01

## Context

Dar Tech OS needs relational integrity, transactions, durable asynchronous work, UTC timestamps, and a migration history. The approved baseline selects PostgreSQL and Prisma.

## Decision

Use PostgreSQL 17 as the system database and Prisma 7 for schema definition, generated access, and migrations. Generated client code is repository-ignored and recreated by the quality gate. Application mutations that emit events use the same Prisma `TransactionClient` for both the mutation and `OutboxEvent` insert.

Raw SQL is permitted only inside infrastructure adapters when Prisma does not expose required database semantics, such as `FOR UPDATE SKIP LOCKED`, leases, and conflict-safe queue insertion. Such SQL stays parameterized and tested against PostgreSQL.

## Alternatives Considered

- SQLite: rejected because it does not match production concurrency and locking behavior.
- Unmanaged SQL scripts without an ORM schema: rejected because schema/client drift would be harder to detect.
- Floating provider-managed database features: deferred until production hosting is approved.

## Consequences

- Local and CI verification require PostgreSQL.
- Migrations are immutable after shared use; corrections use a new migration.
- Prisma schema validation, migration deployment/status, and live schema drift checks are part of the gate.

## Security / Data Impact

Connection URLs are validated and redacted. Production credentials are external configuration, never committed. Foreign keys and restrictive deletion protect receipts and historical events.

## Migration / Rollback

Forward migrations are preferred. Destructive or irreversible migration plans require supervisor approval and a recovery plan.

## References

- `prisma/schema.prisma`
- `prisma/migrations/20260901021500_technical_foundation/migration.sql`
- `docs/engineering/SPRINT_01_FOUNDATION_GUIDE.md`
