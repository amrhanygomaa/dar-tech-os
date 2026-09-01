# Sprint 01 Engineering Foundation Guide

This guide is the operating contract for the Dar Tech OS engineering foundation. Sprint 01 contains technical infrastructure only; it does not authorize a business module.

## Supported toolchain

- Node.js `24.x` (`.nvmrc` pins `24.19.0`)
- npm `11.x` with the committed `package-lock.json`
- Docker Engine and Docker Compose
- PostgreSQL `17` through the repository Compose stack

Run commands from the Git repository root. Never commit `.env`, credentials, generated Prisma client files, build output, or database volumes.

## Workspace and runtime boundaries

| Path | Responsibility |
| --- | --- |
| `apps/web` | Internal Next.js web runtime shell |
| `apps/api` | Versioned NestJS REST API and health endpoints |
| `apps/worker` | Independent queue and outbox processing host |
| `packages/config` | Typed startup configuration and safe summaries |
| `packages/database` | Prisma client, lifecycle, health, and transaction convention |
| `packages/observability` | Structured logs, request/correlation context, and safe errors |
| `packages/queue` | Queue port, PostgreSQL adapter, retry processor, and technical probe |
| `packages/outbox` | Transactional writer, dispatcher, delivery handler, and receipts |
| `prisma` | Technical schema and forward migrations |
| `infra` | Docker and validation scripts |

Shared packages expose deliberate public entry points. Runtime composition selects infrastructure adapters; application handlers must not instantiate provider SDKs.

## Environment and configuration

Copy `.env.example` to `.env` for local development and keep the file untracked. `APP_ENV` distinguishes `development`, `test`, `staging`, and `production`; `NODE_ENV` must match the profile (`staging` uses `production`). API and Worker fail startup when required configuration is missing or invalid.

| Variable | Purpose |
| --- | --- |
| `DATABASE_URL` | Runtime PostgreSQL URL |
| `TEST_DATABASE_URL` | Dedicated integration/migration validation database |
| `DATABASE_POOL_MAX` | Per-runtime connection pool ceiling |
| `API_PORT`, `WEB_PORT` | Host-facing local ports |
| `LOG_LEVEL` | Pino level from `fatal` through `trace` |
| `WORKER_ID` | Lease owner identifier, unique per worker instance |
| `WORKER_QUEUE` | Queue polled by this worker; Sprint 01 uses `foundation` |
| `WORKER_POLL_INTERVAL_MS` | Interval between bounded poll cycles |
| `WORKER_LEASE_DURATION_MS` | Recovery window for abandoned claims |
| `WORKER_RETRY_BASE_DELAY_MS` | Initial exponential retry delay |
| `WORKER_RETRY_MAX_DELAY_MS` | Retry delay cap |
| `WORKER_JOB_MAX_ATTEMPTS` | Default bounded delivery attempts |

Staging and production reject the documented local database username/password. Error output names invalid fields but never echoes connection URLs. Add new configuration through the validated schema, typed runtime interface, `.env.example`, safe summary rules, and tests in the same change.

## Local development

Install dependencies and generate the ignored Prisma client:

```sh
npm ci
npm run db:generate
```

Start PostgreSQL and apply migrations:

```sh
docker compose up -d --wait postgres
npm run db:migrate:deploy
```

With a valid `.env`, run each process in a separate terminal:

```sh
npm run dev:web
npm run dev:api
npm run dev:worker
```

Expected local endpoints:

- Web: `http://localhost:3000`
- API foundation: `http://localhost:3001/api/v1`
- Health: `http://localhost:3001/health`
- Liveness: `http://localhost:3001/health/live`
- Readiness: `http://localhost:3001/health/ready`

`/health/live` checks only the API process. `/health/ready` returns `503` until PostgreSQL is reachable. `/health` reports a safe degraded dependency result without exposing connection details.

## PostgreSQL and Prisma migrations

The Prisma schema is `prisma/schema.prisma`. The generated client is written to `packages/database/src/generated/prisma` and is never committed.

```sh
npm run db:format
npm run db:validate
npm run db:migrate:create -- --name descriptive_change
npm run db:migrate:deploy
npm run db:migrate:status
npm run db:migrate:validate
```

Create migrations only against a developer database. Review generated SQL, constraints, indexes, and deletion behavior before committing. Do not edit a migration that may already have been applied outside the workstation; add a forward corrective migration. Destructive or irreversible changes require supervisor approval.

`db:migrate:validate` compares the live validation database produced by committed migrations with the current Prisma schema and fails on drift. The quality gate targets `dartech_os_test`, never the development database.

Use `runInTransaction(client, work)` for application transactions. Code inside `work` receives a `DatabaseTransaction`; pass that same object to `persistOutboxEvent`.

## Docker workflow

```sh
docker compose up --build -d --wait
docker compose ps
docker compose logs api worker web migrate
```

The `migrate` container must complete successfully before API and Worker start. API, Web, Worker, and PostgreSQL each have explicit health checks. Application containers run as non-root with read-only filesystems and reduced Linux privileges.

Stop containers while preserving PostgreSQL data:

```sh
docker compose down
```

Removing the named database volume deletes local data and is intentionally not part of routine commands.

## Logging, request IDs, and error contract

API middleware validates or creates `X-Request-ID` and `X-Correlation-ID`, returns both headers, and stores them in asynchronous context. The Worker restores `correlationId` and `jobId` around every dispatcher and job execution. Structured logs use stable event names and include trusted context fields.

Never log request bodies, credentials, provider tokens, connection URLs, or raw unknown exceptions. The logger redacts sensitive keys and common secret patterns. Unknown API failures return:

```json
{
  "error": {
    "code": "INTERNAL_ERROR",
    "message": "An unexpected error occurred",
    "requestId": "..."
  }
}
```

Successful API responses use `{ "data": ..., "meta": { "requestId": "..." } }`. Add stable machine-readable error codes to the shared type contract before using them.

## Worker and queue convention

Publish through `JobQueuePort`; the current adapter is `PostgresJobQueue`. Every job carries a lowercase queue/name, positive version, JSON payload, correlation ID, bounded `maxAttempts`, and optional organization/causation/deduplication metadata.

Handler rules:

1. Give the handler a stable name and version.
2. Validate the payload before doing work.
3. Throw `RetryableJobError` only for transient failures.
4. Throw `NonRetryableJobError` for invalid payloads or permanent routing failures.
5. Make effects idempotent when duplicates would matter.
6. Register the handler in Worker composition and add unit/integration tests.

Claims use leases and `FOR UPDATE SKIP LOCKED`. An expired lease is recoverable while attempts remain. The processor uses capped exponential backoff and persists `FAILED` after a non-retryable error or exhausted attempts. Stored failure messages are safe and bounded.

Run the deterministic technical retry probe with PostgreSQL and Worker configuration loaded:

```sh
npm run sample:retry --workspace=@dar-tech/worker
```

The command prints the job, correlation, and probe IDs. Enqueuing the same deduplication key and identical content returns the original job; reusing it for different content is a conflict.

## Transactional outbox convention

Write the event with its originating mutation:

```ts
await runInTransaction(client, async (transaction) => {
  await applicationMutation(transaction);
  await persistOutboxEvent(transaction, {
    eventType: 'module.event-name',
    eventVersion: 1,
    payload: { entityId },
    correlationId,
  });
});
```

The complete reference flow is:

```text
application transaction
  -> OutboxEvent(PENDING)
  -> lease-based dispatcher
  -> JobQueuePort.enqueue(deterministic deduplication key)
  -> OutboxEvent(PROCESSED)
  -> worker delivery with retry/terminal failure
  -> consumer effect + OutboxConsumerReceipt in one transaction
```

`OutboxEvent.PROCESSED` means durable queue handoff, not consumer success. Queue state records delivery outcome; `OutboxConsumerReceipt(eventId, consumerName)` records consumer success. Receipt insertion happens before the effect in the same transaction. If the consumer throws, both roll back. If a duplicate delivery finds the receipt, the effect is skipped.

Use immutable event names and positive versions. Consumers must explicitly register the supported version. Do not put secrets in event payloads. Preserve organization, correlation, causation, and occurred-at metadata.

Run the non-business reference event:

```sh
npm run sample:outbox --workspace=@dar-tech/worker
```

It requests one controlled consumer retry, then completes with one receipt.

## Local and CI quality gate

The single acceptance command is:

```sh
npm run quality:gate
```

Locally it starts the repository PostgreSQL service, targets the dedicated `dartech_os_test` database, and then runs:

1. `npm ci` lockfile/install integrity
2. ESLint with zero warnings
3. Prisma client generation and schema validation
4. Migration deployment, status, and live schema drift validation
5. TypeScript typecheck
6. Unit tests
7. PostgreSQL integration tests
8. Production build
9. Docker Compose configuration validation

GitHub Actions invokes the same command with a PostgreSQL service. A broken lockfile, source file, test, migration, schema, build, or Compose definition fails the job.

## Provider portability

Hostinger is the first deployment environment, not an application dependency. PostgreSQL and Docker supply the initial portable substrate. Provider adapters are selected only in runtime composition. Business/application code depends on ports and versioned envelopes, never Hostinger or AWS SDK types.

An AWS queue adapter must match the existing contract for correlation, bounded retry, durable handoff, deduplication, and observable terminal failure. A provider cutover must drain or explicitly transfer pending work and requires a reviewed operational plan.

## Troubleshooting

- Missing `generated/prisma/client.js`: run `npm run db:generate` or the full gate.
- Readiness is `503`: confirm `docker compose ps postgres` is healthy and `DATABASE_URL` points to the exposed port.
- Integration tests fail to connect: use `npm run quality:gate`, which supplies the local test database URL.
- A queue item remains `PENDING`: compare `availableAt` with current UTC time and confirm the Worker polls its queue.
- A job/event is `FAILED`: inspect safe error code, attempt count, and correlation ID; do not edit the row to bypass idempotency or audit history.
