# ADR-0001 — Modular Monolith

**Status:** Accepted
**Date:** 2026-09-01

## Context

Dar Tech OS will contain multiple business domains, but Sprint 01 needs a deployable foundation without the operational and consistency costs of premature microservices. The approved architecture already selects a modular monolith.

## Decision

Use one TypeScript repository with npm workspaces and explicit runtime boundaries for Web, API, and Worker. Reusable technical capabilities live in packages with narrow public exports. Future business domains will remain internal modules behind application interfaces; they will not reach into another module's persistence internals.

The API remains a NestJS modular monolith. The Worker is a separate runtime from the same versioned codebase, not an independently owned microservice.

## Alternatives Considered

- Microservices per domain: rejected because domain boundaries, load profiles, and operational need are not yet proven.
- One unstructured application package: rejected because it would make domain and provider coupling difficult to control.

## Consequences

- Transactions and refactoring remain straightforward while the product is young.
- Module boundaries require code review and tests because they are not network boundaries.
- A module can be extracted later only with an approved, measurable reason.

## Security / Data Impact

Authorization and audit policy remain centralized at application boundaries. A package boundary never grants direct database or privileged access.

## Migration / Rollback

No data migration is required. Reverting the workspace skeleton would remove the agreed runtime boundaries and is therefore an architecture change requiring review.

## References

- `CODEX_MASTER_EXECUTION_PROMPT.md`
- `SPRINT_01_ENGINEERING_FOUNDATION.md`
- `docs/engineering/SPRINT_01_FOUNDATION_GUIDE.md`
