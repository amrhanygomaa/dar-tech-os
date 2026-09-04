# Dar Tech OS

Internal company operating system for Dar Tech.

## Current status

**Sprint 01 — Engineering Foundation: COMPLETED**

Sprint 02 remains under controlled implementation. S02-T00 through S02-T08 and S02-T12 are complete. S02-T08 was merged through PR #13; its final reviewed implementation head is `d746e655496699fec3eb11b525f20d4f675cd892`, and its canonical merge/main SHA is `6402bd8c5ea6ca16ba76e2750c648506011b5cea`. S02-T09 through S02-T11 and S02-T13 through S02-T15 remain unauthorized. No real business relationship resolver or business module has been installed.

## Start here

Codex must read these files before implementation:

1. `CODEX_MASTER_EXECUTION_PROMPT.md`
2. The active ticket in `SPRINT_02_IDENTITY_SECURITY_FOUNDATION.md`
3. `docs/SOURCE_OF_TRUTH.md`
4. `docs/README.md`
5. Only the documentation relevant to the active ticket

Do **not** start S02-T09+ or any business module without explicit supervisor authorization.

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
