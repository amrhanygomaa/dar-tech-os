# Dar Tech OS — Sprint 01
## Engineering Foundation
### Execution status: READY FOR CODEX

## Sprint objective

Create a reliable engineering substrate for Dar Tech OS without prematurely building business modules.

## Tickets

### S01-T01 — Repository Discovery & Baseline
Inspect repository structure, package manager, frameworks, versions, DB/ORM, tests, lint, build, CI, Docker and environment handling. Run current baseline checks. Create `docs/engineering/REPOSITORY_BASELINE.md`. Do not restructure code in this ticket.

### S01-T02 — Workspace / Module Skeleton
Using the actual repository baseline, create/normalize clear boundaries for web, API, worker/background jobs, DB/migrations, shared config/types, docs and infra. Preserve working application behavior. Do not scaffold all future business modules yet.

### S01-T03 — Environment & Configuration Foundation
Add a safe `.env.example`, typed/validated config, dev/staging/production distinctions, startup validation, and secret-safe logging.

### S01-T04 — PostgreSQL + Prisma Foundation
Configure PostgreSQL/Prisma, migration workflow, seed framework, transaction convention and DB health check. Do not prematurely implement the whole final business schema.

### S01-T05 — Docker Local Stack
Make web/API/worker/PostgreSQL reproducibly runnable. Add health checks, persistent dev DB storage and documented local commands.

### S01-T06 — Request IDs, Logging & Errors
Implement structured logs, request/correlation IDs, safe error envelope, stable error codes and production-safe error behavior.

### S01-T07 — Health/Readiness/Liveness
Implement `/health`, `/health/live`, `/health/ready`. Readiness includes critical dependencies such as DB availability.

### S01-T08 — Worker/Job Foundation
Implement an independent worker runtime, job handler convention, retry metadata, correlation IDs and a replaceable queue/provider adapter. Prove with a non-business sample job.

### S01-T09 — Outbox Foundation
Implement persistent outbox records, transaction-write convention, dispatcher, event IDs/types/versions, retry/failed state, and idempotent reference processing.

### S01-T10 — CI / Quality Gate
Create a reliable local/CI gate covering install integrity, lint, typecheck, tests, build, and migration/schema validation. The gate must fail when the code is broken.

### S01-T11 — Foundation Docs & ADRs
Document local setup, environment, DB/migrations, worker/queue, outbox, logging/errors, CI commands, and deployment portability. Add ADRs for Modular Monolith, PostgreSQL+Prisma, Docker, Outbox and provider abstraction.

## Sprint constraints

Do not build CRM, Sales, Projects, Finance, Licensing, Warranty, AI, MCP or customer-facing features in Sprint 01.

Do not introduce microservices.

Do not commit real secrets.

Do not destructively rewrite working repository structure just to match an example directory tree.

## Acceptance gate

- Repository baseline documented ✅
- Existing app behavior preserved ✅
- Environment validation works ✅
- PostgreSQL/Prisma migration flow works ✅
- Web/API/worker run predictably ✅
- Docker local stack works ✅
- Request/correlation IDs work ✅
- Safe error contract works ✅
- Health/readiness/liveness work ✅
- Worker retry foundation works ✅
- Outbox reference flow works and is retry-safe ✅
- CI/quality gate passes ✅
- Foundation documentation/ADRs exist ✅
- No production secrets committed ✅
- No premature business modules implemented ✅

## Required Codex final report

At the end of Sprint 01, provide:
- completed tickets;
- architecture changes;
- files added/changed;
- migrations;
- commands run and results;
- failing pre-existing checks, if any;
- remaining technical debt;
- any supervisor decisions required;
- confirmation whether Sprint 01 gate passes.
