import { createHash, randomUUID } from 'node:crypto';
import type { DatabaseClient } from '@dar-tech/database';
import { Prisma } from '@dar-tech/database';
import { isValidCorrelationIdentifier } from '@dar-tech/observability';
import type {
  ClaimedJob,
  ClaimJobOptions,
  EnqueueJobInput,
  EnqueueJobResult,
  FailClaimedJobInput,
  JobFailure,
  JobQueuePort,
} from './contracts.js';
import {
  QueueDeduplicationConflictError,
  QueueLeaseLostError,
} from './errors.js';

const queueNamePattern = /^[a-z][a-z0-9._-]{0,63}$/u;
const jobNamePattern = /^[a-z][a-z0-9]*(?:[._-][a-z0-9]+)+$/u;
const uuidPattern =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;

interface RawClaimedJob {
  readonly id: string;
  readonly queue: string;
  readonly name: string;
  readonly version: number;
  readonly payload: unknown;
  readonly organizationId: string | null;
  readonly correlationId: string;
  readonly causationId: string | null;
  readonly attemptNumber: number;
  readonly maxAttempts: number;
  readonly leaseToken: string;
}

function canonicalJson(value: unknown, path = 'payload'): string {
  if (
    value === null ||
    typeof value === 'boolean' ||
    typeof value === 'string'
  ) {
    return JSON.stringify(value);
  }

  if (typeof value === 'number') {
    if (!Number.isFinite(value)) {
      throw new TypeError(`${path} must contain only finite numbers`);
    }
    return JSON.stringify(value);
  }

  if (Array.isArray(value)) {
    return `[${value.map((item, index) => canonicalJson(item, `${path}[${index}]`)).join(',')}]`;
  }

  if (value && typeof value === 'object') {
    const prototype = Object.getPrototypeOf(value) as object | null;
    if (prototype !== Object.prototype && prototype !== null) {
      throw new TypeError(`${path} must contain only JSON-compatible objects`);
    }

    const entries = Object.entries(
      value as Readonly<Record<string, unknown>>,
    ).sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0));
    return `{${entries
      .map(
        ([key, nested]) =>
          `${JSON.stringify(key)}:${canonicalJson(nested, `${path}.${key}`)}`,
      )
      .join(',')}}`;
  }

  throw new TypeError(`${path} must be JSON-compatible`);
}

function validDate(value: Date): boolean {
  return !Number.isNaN(value.getTime());
}

function assertEnqueueInput(input: EnqueueJobInput): void {
  if (!queueNamePattern.test(input.queue)) {
    throw new TypeError('Queue name is invalid');
  }
  if (input.name.length > 160 || !jobNamePattern.test(input.name)) {
    throw new TypeError('Job name is invalid');
  }
  if (!Number.isSafeInteger(input.version) || input.version < 1) {
    throw new TypeError('Job version must be a positive integer');
  }
  if (
    !Number.isSafeInteger(input.maxAttempts) ||
    input.maxAttempts < 1 ||
    input.maxAttempts > 25
  ) {
    throw new TypeError('Job maxAttempts must be between 1 and 25');
  }
  if (!isValidCorrelationIdentifier(input.correlationId)) {
    throw new TypeError('Job correlation ID is invalid');
  }
  if (input.causationId && !isValidCorrelationIdentifier(input.causationId)) {
    throw new TypeError('Job causation ID is invalid');
  }
  if (input.organizationId && !uuidPattern.test(input.organizationId)) {
    throw new TypeError('Job organization ID is invalid');
  }
  if (
    input.deduplicationKey !== undefined &&
    (input.deduplicationKey.length < 1 || input.deduplicationKey.length > 255)
  ) {
    throw new TypeError('Job deduplication key is invalid');
  }
  if (input.availableAt && !validDate(input.availableAt)) {
    throw new TypeError('Job availableAt must be a valid date');
  }
}

function assertClaimOptions(options: ClaimJobOptions): void {
  if (!queueNamePattern.test(options.queue)) {
    throw new TypeError('Queue name is invalid');
  }
  if (!isValidCorrelationIdentifier(options.workerId)) {
    throw new TypeError('Worker ID is invalid');
  }
  if (
    !Number.isSafeInteger(options.leaseDurationMs) ||
    options.leaseDurationMs < 1 ||
    options.leaseDurationMs > 3_600_000
  ) {
    throw new TypeError(
      'Lease duration must be between 1 and 3600000 milliseconds',
    );
  }
}

function safeFailure(failure: JobFailure): JobFailure {
  const code = /^[a-z][a-z0-9._-]{0,127}$/u.test(failure.code)
    ? failure.code
    : 'queue.job_failed';
  const message = failure.message
    .replace(
      /(postgres(?:ql)?:\/\/)[^:\s/@]+:[^@\s/]+@/giu,
      '$1[REDACTED]:[REDACTED]@',
    )
    .replace(/\bBearer\s+[A-Za-z0-9._~+\/-]+=*/giu, 'Bearer [REDACTED]')
    .replace(
      /\b(password|secret|token|authorization)\s*[:=]\s*[^\s,;]+/giu,
      '$1=[REDACTED]',
    )
    .replace(/[\u0000-\u001f\u007f]+/gu, ' ')
    .trim()
    .slice(0, 2_048);
  return {
    code,
    message: message || 'Job processing failed',
  };
}

function deduplicationHash(
  input: EnqueueJobInput,
  payloadJson: string,
): string {
  const identity = canonicalJson({
    name: input.name,
    organizationId: input.organizationId ?? null,
    payload: JSON.parse(payloadJson) as unknown,
    version: input.version,
  });
  return createHash('sha256').update(identity).digest('hex');
}

export class PostgresJobQueue implements JobQueuePort {
  constructor(private readonly client: DatabaseClient) {}

  async enqueue(input: EnqueueJobInput): Promise<EnqueueJobResult> {
    assertEnqueueInput(input);
    const payloadJson = canonicalJson(input.payload);
    const availableAt = input.availableAt ?? new Date();

    if (!input.deduplicationKey) {
      const job = await this.client.queueJob.create({
        data: {
          queue: input.queue,
          name: input.name,
          version: input.version,
          payload: JSON.parse(payloadJson) as Prisma.InputJsonValue,
          ...(input.organizationId
            ? { organizationId: input.organizationId }
            : {}),
          correlationId: input.correlationId,
          ...(input.causationId ? { causationId: input.causationId } : {}),
          availableAt,
          maxAttempts: input.maxAttempts,
        },
        select: { id: true },
      });
      return { jobId: job.id, deduplicated: false };
    }

    const jobId = randomUUID();
    const contentHash = deduplicationHash(input, payloadJson);
    const inserted = await this.client.$queryRaw<
      readonly { id: string }[]
    >(Prisma.sql`
      INSERT INTO "queue_jobs" (
        "id", "queue", "name", "version", "payload", "organization_id",
        "correlation_id", "causation_id", "deduplication_key", "deduplication_hash",
        "available_at", "max_attempts", "updated_at"
      ) VALUES (
        ${jobId}::uuid, ${input.queue}, ${input.name}, ${input.version}, ${payloadJson}::jsonb,
        ${input.organizationId ?? null}::uuid, ${input.correlationId}, ${input.causationId ?? null},
        ${input.deduplicationKey}, ${contentHash}, ${availableAt}, ${input.maxAttempts}, CURRENT_TIMESTAMP
      )
      ON CONFLICT ("queue", "deduplication_key") DO NOTHING
      RETURNING "id"
    `);

    if (inserted[0]) {
      return { jobId: inserted[0].id, deduplicated: false };
    }

    const existing = await this.client.queueJob.findFirst({
      where: {
        queue: input.queue,
        deduplicationKey: input.deduplicationKey,
      },
      select: {
        id: true,
        deduplicationHash: true,
      },
    });
    if (!existing || existing.deduplicationHash !== contentHash) {
      throw new QueueDeduplicationConflictError();
    }

    return { jobId: existing.id, deduplicated: true };
  }

  async claimNext(options: ClaimJobOptions): Promise<ClaimedJob | null> {
    assertClaimOptions(options);

    await this.client.$executeRaw(Prisma.sql`
      UPDATE "queue_jobs"
      SET
        "status" = 'FAILED',
        "locked_by" = NULL,
        "lease_token" = NULL,
        "locked_at" = NULL,
        "lock_expires_at" = NULL,
        "last_error_code" = 'queue.lease_expired',
        "last_error_message" = 'The final processing lease expired',
        "failed_at" = CURRENT_TIMESTAMP,
        "updated_at" = CURRENT_TIMESTAMP
      WHERE
        "queue" = ${options.queue}
        AND "attempt_count" >= "max_attempts"
        AND (
          ("status" = 'PENDING' AND "available_at" <= CURRENT_TIMESTAMP)
          OR (
            "status" = 'PROCESSING'
            AND ("lock_expires_at" IS NULL OR "lock_expires_at" <= CURRENT_TIMESTAMP)
          )
        )
    `);

    const leaseToken = randomUUID();
    const rows = await this.client.$queryRaw<
      readonly RawClaimedJob[]
    >(Prisma.sql`
      WITH candidate AS (
        SELECT "id"
        FROM "queue_jobs"
        WHERE
          "queue" = ${options.queue}
          AND "attempt_count" < "max_attempts"
          AND (
            ("status" = 'PENDING' AND "available_at" <= CURRENT_TIMESTAMP)
            OR (
              "status" = 'PROCESSING'
              AND ("lock_expires_at" IS NULL OR "lock_expires_at" <= CURRENT_TIMESTAMP)
            )
          )
        ORDER BY "available_at" ASC, "created_at" ASC
        FOR UPDATE SKIP LOCKED
        LIMIT 1
      )
      UPDATE "queue_jobs" AS job
      SET
        "status" = 'PROCESSING',
        "attempt_count" = job."attempt_count" + 1,
        "locked_by" = ${options.workerId},
        "lease_token" = ${leaseToken}::uuid,
        "locked_at" = CURRENT_TIMESTAMP,
        "lock_expires_at" = CURRENT_TIMESTAMP + (${options.leaseDurationMs} * INTERVAL '1 millisecond'),
        "updated_at" = CURRENT_TIMESTAMP
      FROM candidate
      WHERE job."id" = candidate."id"
      RETURNING
        job."id",
        job."queue",
        job."name",
        job."version",
        job."payload",
        job."organization_id" AS "organizationId",
        job."correlation_id" AS "correlationId",
        job."causation_id" AS "causationId",
        job."attempt_count" AS "attemptNumber",
        job."max_attempts" AS "maxAttempts",
        job."lease_token" AS "leaseToken"
    `);

    return rows[0] ?? null;
  }

  async complete(job: ClaimedJob): Promise<void> {
    const updated = await this.client.$executeRaw(Prisma.sql`
      UPDATE "queue_jobs"
      SET
        "status" = 'SUCCEEDED',
        "locked_by" = NULL,
        "lease_token" = NULL,
        "locked_at" = NULL,
        "lock_expires_at" = NULL,
        "completed_at" = CURRENT_TIMESTAMP,
        "updated_at" = CURRENT_TIMESTAMP
      WHERE
        "id" = ${job.id}::uuid
        AND "status" = 'PROCESSING'
        AND "lease_token" = ${job.leaseToken}::uuid
    `);
    if (updated !== 1) {
      throw new QueueLeaseLostError();
    }
  }

  async fail(input: FailClaimedJobInput): Promise<void> {
    const failure = safeFailure(input.failure);
    const retryAt =
      input.retryAt && input.job.attemptNumber < input.job.maxAttempts
        ? input.retryAt
        : null;
    if (retryAt && !validDate(retryAt)) {
      throw new TypeError('Retry timestamp must be a valid date');
    }

    const updated = retryAt
      ? await this.client.$executeRaw(Prisma.sql`
          UPDATE "queue_jobs"
          SET
            "status" = 'PENDING',
            "available_at" = ${retryAt},
            "locked_by" = NULL,
            "lease_token" = NULL,
            "locked_at" = NULL,
            "lock_expires_at" = NULL,
            "last_error_code" = ${failure.code},
            "last_error_message" = ${failure.message},
            "updated_at" = CURRENT_TIMESTAMP
          WHERE
            "id" = ${input.job.id}::uuid
            AND "status" = 'PROCESSING'
            AND "lease_token" = ${input.job.leaseToken}::uuid
        `)
      : await this.client.$executeRaw(Prisma.sql`
          UPDATE "queue_jobs"
          SET
            "status" = 'FAILED',
            "locked_by" = NULL,
            "lease_token" = NULL,
            "locked_at" = NULL,
            "lock_expires_at" = NULL,
            "last_error_code" = ${failure.code},
            "last_error_message" = ${failure.message},
            "failed_at" = CURRENT_TIMESTAMP,
            "updated_at" = CURRENT_TIMESTAMP
          WHERE
            "id" = ${input.job.id}::uuid
            AND "status" = 'PROCESSING'
            AND "lease_token" = ${input.job.leaseToken}::uuid
        `);

    if (updated !== 1) {
      throw new QueueLeaseLostError();
    }
  }
}
