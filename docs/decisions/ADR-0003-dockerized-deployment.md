# ADR-0003 — Dockerized Deployment

**Status:** Accepted
**Date:** 2026-09-01

## Context

Web, API, Worker, migration runner, and PostgreSQL must run reproducibly on developer machines and on a Hostinger-first production host without binding the application to that host.

## Decision

Build immutable multi-stage Docker images from one Dockerfile and orchestrate the local stack with Docker Compose. Migrations run as a one-shot service before API and Worker startup. Runtime containers use a non-root user, read-only root filesystem, dropped capabilities, `no-new-privileges`, explicit health checks, and UTC.

The repository keeps application images stateless. PostgreSQL data is the only Compose persistent volume.

## Alternatives Considered

- Host-native process managers: rejected as the primary contract because they increase environment drift.
- Kubernetes: rejected for Sprint 01 because its operational complexity is unnecessary.
- One container containing every runtime: rejected because health, scaling, and failure boundaries would be obscured.

## Consequences

- Docker is required for full local acceptance verification.
- Each runtime can be moved or scaled independently while using the same artifact version.
- Image and Compose validation are part of Sprint 01 verification.

## Security / Data Impact

Secrets enter through runtime environment or a future secret manager, not image layers. Ports bind to localhost in local Compose. Database storage persists independently from application containers.

## Migration / Rollback

Rollback redeploys a previously built application image only when its schema expectations remain compatible. Database rollback follows ADR-0002.

## References

- `infra/docker/Dockerfile`
- `compose.yaml`
- `docs/engineering/SPRINT_01_FOUNDATION_GUIDE.md`
