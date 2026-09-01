# Repository Baseline

**Ticket:** S01-T01 — Repository Discovery & Baseline  
**Captured:** 2026-09-01  
**Baseline commit:** `cc859738ad2dc3fde18904c5da0672ad0c2f1b28`  
**Implementation branch:** `codex/sprint-01-foundation`

## Repository synchronization

`git fetch --prune origin` completed successfully before implementation. Local `main` and `origin/main` both resolved to the baseline commit above, and `git rev-list --left-right --count main...origin/main` returned `0 0`. The implementation branch was created directly from that `origin/main` revision. The worktree was clean.

## Current repository structure

The baseline repository is a documentation-first scaffold. Its implementation directories contain only placeholder files.

```text
.
|-- .github/
|   `-- pull_request_template.md
|-- apps/
|   `-- .gitkeep
|-- docs/
|   |-- architecture/
|   |-- brand/
|   |-- decisions/
|   |-- engineering/
|   |-- execution/
|   |-- integrations/
|   |-- security/
|   |-- source/
|   `-- ux/
|-- infra/
|   `-- .gitkeep
|-- packages/
|   `-- .gitkeep
|-- prisma/
|   `-- .gitkeep
|-- .env.example
|-- .gitignore
|-- AGENTS.md
|-- CODEX_MASTER_EXECUTION_PROMPT.md
|-- CONTRIBUTING.md
|-- README.md
`-- SPRINT_01_ENGINEERING_FOUNDATION.md
```

There is no pre-existing application behavior or implementation code to migrate. The approved documents establish the intended TypeScript, NestJS, PostgreSQL, Prisma, modular-monolith, Docker, worker, and outbox baseline.

## Package manager and runtime

- No package manager was selected in the repository: there was no `package.json`, lockfile, workspace file, `packageManager` field, `.nvmrc`, or `.node-version`.
- `.gitignore` mentioned `.pnpm-store/`, but this does not establish pnpm as a project requirement.
- Local discovery environment:
  - Node.js `v24.19.0`
  - npm `11.17.0`
  - Corepack `0.35.0`
  - pnpm not installed
  - Yarn not installed

Sprint 01 may select a package manager and supported runtime only after this inventory. The selection and supported runtime must be recorded in the engineering setup documentation.

## Existing applications and packages

- `apps/`: no web, API, or worker implementation.
- `packages/`: no shared package implementation.
- `infra/`: no infrastructure implementation.
- `prisma/`: no schema or migration implementation.

No source files, workspace configuration, TypeScript configuration, or framework CLI configuration existed.

## Frameworks and versions

No framework packages or versions were present. In particular, NestJS, React/Next.js, Prisma, a logging framework, a validation library, and a test framework were not installed or configured.

## Database and ORM state

- No Prisma schema, client generation configuration, migrations, migration lock, seed script, repository convention, or transaction helper existed.
- No repository-managed PostgreSQL service or connection check existed.
- `.env.example` contained a safe local PostgreSQL URL placeholder, but nothing loaded or validated it.
- There was no business or technical database schema.

## Docker state

- No `Dockerfile`, Compose file, container health check, development volume, or Docker documentation existed.
- Local Docker CLI: `29.7.2`.
- Local Docker Compose CLI: `v5.3.1`.
- The Docker daemon was not running during baseline discovery, so daemon-backed baseline checks could not execute.

## CI state

- `.github/pull_request_template.md` listed expected validation checkboxes.
- No `.github/workflows/` directory or CI workflow existed.
- There was no automated install, lint, typecheck, test, build, migration, dependency audit, or secret scan gate.

## Lint, typecheck, test, and build tooling

No `package.json`, scripts, dependency installation, ESLint configuration, formatter configuration, TypeScript project, test runner, build tool, or Prisma CLI configuration existed. Consequently, install integrity, lint, typecheck, unit tests, integration tests, build, Prisma generation, schema validation, and migration validation were unavailable rather than passing.

## Environment handling

The baseline `.env.example` included safe local examples for:

- `NODE_ENV=development`
- `DATABASE_URL`
- `API_PORT=3001`
- `WEB_PORT=3000`
- `LOG_LEVEL=info`

`.gitignore` excluded `.env` and `.env.*` while retaining `.env.example`. There was no typed loader, startup validation, staging/production distinction, secret reference convention, or log redaction. No real credentials were found in the implementation scaffold.

## Baseline command results

| Command/check | Result | Baseline interpretation |
| --- | --- | --- |
| `git fetch --prune origin` | PASS | Origin references refreshed. |
| `git rev-list --left-right --count main...origin/main` | PASS (`0 0`) | Local `main` matched `origin/main`. |
| `git status --short --branch` | PASS | Clean implementation branch tracking the baseline. |
| `node --version` | PASS (`v24.19.0`) | Node was available locally; no project range was declared. |
| `npm --version` | PASS (`11.17.0`) | npm was available locally; no package manager was selected. |
| `corepack --version` | PASS (`0.35.0`) | Corepack was available. |
| `pnpm --version` | UNAVAILABLE | pnpm was not installed. |
| `yarn --version` | UNAVAILABLE | Yarn was not installed. |
| `docker --version` | PASS (`29.7.2`) | Docker CLI was installed. |
| `docker compose version` | PASS (`v5.3.1`) | Compose CLI was installed. |
| `docker info --format '{{.ServerVersion}}'` | FAIL (pre-existing environment) | Docker Desktop Linux daemon was not running. |
| `docker compose config --quiet` | FAIL (pre-existing repository) | No Compose configuration existed. |
| Dependency/install integrity | UNAVAILABLE | No manifest or lockfile existed. |
| Lint | UNAVAILABLE | No lint configuration or script existed. |
| Typecheck | UNAVAILABLE | No TypeScript project or script existed. |
| Unit/integration tests | UNAVAILABLE | No test configuration, tests, or script existed. |
| Build | UNAVAILABLE | No application or build script existed. |
| Prisma/schema/migration validation | UNAVAILABLE | No Prisma dependency, schema, or migrations existed. |

## Pre-existing failures and gaps

The following conditions pre-date Sprint 01 implementation and must not be presented as regressions introduced by it:

1. All engineering quality checks were unavailable because the repository had no implementation/tooling manifest.
2. Docker Compose validation failed because no Compose file existed.
3. Docker daemon-backed verification could not run because Docker Desktop's Linux engine was unavailable during discovery.
4. No web, API, worker, database, migration, queue, outbox, health, logging, or error framework existed.
5. Environment values were examples only and were not validated at runtime.

These gaps are the authorized scope of S01-T02 through S01-T11. They are not authorization to implement any Sprint 02 or business-domain module.
