# Dar Tech OS

Internal company operating system for Dar Tech.

## Current status

**Sprint 01 — Engineering Foundation: COMPLETED**

Sprint 02 is under controlled implementation. S02-T00 and S02-T01 are complete; S02-T03 is the only currently authorized ticket. S02-T02 and S02-T04 through S02-T15 remain unauthorized. Business-module implementation has not started.

## Start here

Codex must read these files before implementation:

1. `CODEX_MASTER_EXECUTION_PROMPT.md`
2. The active ticket in `SPRINT_02_IDENTITY_SECURITY_FOUNDATION.md`
3. `docs/SOURCE_OF_TRUTH.md`
4. `docs/README.md`
5. Only the documentation relevant to the active ticket

Do **not** start another Sprint 02 ticket or any business module without explicit supervisor authorization.

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
