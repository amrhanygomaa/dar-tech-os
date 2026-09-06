# Dar Tech OS

Internal company operating system for Dar Tech.

## Current status

**Sprint 01 — Engineering Foundation: COMPLETED**

Sprint 02 remains under controlled implementation. The currently implemented identity/security foundation through S02-T11 is complete: the completed ticket set is S02-T00 through S02-T12, with its actual execution chronology recorded in the sprint specification. S02-T11 is **COMPLETED — CLOSED — MERGED** through implementation PR #19; its final reviewed implementation head is `7b4ec88513ac1ed22cd7cadd32ea17607ab4dd21`, and canonical T11 merge/main SHA is `ef5e71ee92f2870e28cb51948f9e4b1df230b003`. S02-T13 through S02-T15 remain unauthorized. No production approval policy or approver binding has been introduced.

## Start here

Codex must read these files before implementation:

1. `CODEX_MASTER_EXECUTION_PROMPT.md`
2. The active ticket in `SPRINT_02_IDENTITY_SECURITY_FOUNDATION.md`
3. `docs/SOURCE_OF_TRUTH.md`
4. `docs/README.md`
5. Only the documentation relevant to the active ticket

Do **not** start S02-T13 or any later unauthorized ticket/business module without explicit supervisor authorization.

## Initial architecture baseline

- Internal-only web application
- TypeScript + NestJS backend
- PostgreSQL
- Prisma
- Modular Monolith
- Docker
- Event/outbox/background worker foundation
- Hostinger-first deployment with AWS portability

See the master specifications under `docs/` for detailed requirements and guardrails.

## Foundation commands

```sh
npm run quality:gate
docker compose up --build -d --wait
```

See `docs/engineering/SPRINT_01_FOUNDATION_GUIDE.md` for local development, configuration, migrations, Docker, logging/errors, worker/queue, outbox, CI, and portability conventions.
