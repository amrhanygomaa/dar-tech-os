import { randomUUID } from 'node:crypto';
import { Prisma, type DatabaseClient } from '@dar-tech/database';
import { isValidCorrelationIdentifier } from '@dar-tech/observability';
import type {
  ClaimedOutboxEvent,
  ClaimOutboxOptions,
  FailClaimedOutboxEventInput,
  OutboxFailure,
  OutboxStorePort,
} from './contracts.js';

interface RawClaimedOutboxEvent {
  readonly id: string;
  readonly eventType: string;
  readonly eventVersion: number;
  readonly payload: unknown;
  readonly organizationId: string | null;
  readonly correlationId: string;
  readonly causationId: string | null;
  readonly occurredAt: Date;
  readonly attemptNumber: number;
  readonly maxAttempts: number;
  readonly leaseToken: string;
}

export class OutboxLeaseLostError extends Error {
  constructor() {
    super('The outbox event lease is no longer owned by this dispatcher');
    this.name = 'OutboxLeaseLostError';
  }
}

function assertClaimOptions(options: ClaimOutboxOptions): void {
  if (!isValidCorrelationIdentifier(options.workerId)) {
    throw new TypeError('Outbox dispatcher ID is invalid');
  }
  if (
    !Number.isSafeInteger(options.leaseDurationMs) ||
    options.leaseDurationMs < 1 ||
    options.leaseDurationMs > 3_600_000
  ) {
    throw new TypeError('Outbox lease duration must be between 1 and 3600000 milliseconds');
  }
}

function safeFailure(failure: OutboxFailure): OutboxFailure {
  const code = /^[a-z][a-z0-9._-]{0,127}$/u.test(failure.code)
    ? failure.code
    : 'outbox.dispatch_failed';
  const message = failure.message
    .replace(
      /(postgres(?:ql)?:\/\/)[^:\s/@]+:[^@\s/]+@/giu,
      '$1[REDACTED]:[REDACTED]@',
    )
    .replace(/\bBearer\s+[A-Za-z0-9._~+/-]+=*/giu, 'Bearer [REDACTED]')
    .replace(/[\u0000-\u001f\u007f]+/gu, ' ')
    .trim()
    .slice(0, 2_048);
  return { code, message: message || 'Outbox dispatch failed' };
}

export class PostgresOutboxStore implements OutboxStorePort {
  constructor(private readonly client: DatabaseClient) {}

  async claimNext(options: ClaimOutboxOptions): Promise<ClaimedOutboxEvent | null> {
    assertClaimOptions(options);

    await this.client.$executeRaw(Prisma.sql`
      UPDATE "outbox_events"
      SET
        "status" = 'FAILED',
        "locked_by" = NULL,
        "lease_token" = NULL,
        "locked_at" = NULL,
        "lock_expires_at" = NULL,
        "last_error_code" = 'outbox.lease_expired',
        "last_error_message" = 'The final dispatch lease expired',
        "failed_at" = CURRENT_TIMESTAMP,
        "updated_at" = CURRENT_TIMESTAMP
      WHERE
        "attempt_count" >= "max_attempts"
        AND (
          ("status" = 'PENDING' AND "available_at" <= CURRENT_TIMESTAMP)
          OR (
            "status" = 'PROCESSING'
            AND ("lock_expires_at" IS NULL OR "lock_expires_at" <= CURRENT_TIMESTAMP)
          )
        )
    `);

    const leaseToken = randomUUID();
    const rows = await this.client.$queryRaw<readonly RawClaimedOutboxEvent[]>(Prisma.sql`
      WITH candidate AS (
        SELECT "id"
        FROM "outbox_events"
        WHERE
          "attempt_count" < "max_attempts"
          AND (
            ("status" = 'PENDING' AND "available_at" <= CURRENT_TIMESTAMP)
            OR (
              "status" = 'PROCESSING'
              AND ("lock_expires_at" IS NULL OR "lock_expires_at" <= CURRENT_TIMESTAMP)
            )
          )
        ORDER BY "available_at" ASC, "occurred_at" ASC
        FOR UPDATE SKIP LOCKED
        LIMIT 1
      )
      UPDATE "outbox_events" AS event
      SET
        "status" = 'PROCESSING',
        "attempt_count" = event."attempt_count" + 1,
        "locked_by" = ${options.workerId},
        "lease_token" = ${leaseToken}::uuid,
        "locked_at" = CURRENT_TIMESTAMP,
        "lock_expires_at" = CURRENT_TIMESTAMP + (${options.leaseDurationMs} * INTERVAL '1 millisecond'),
        "updated_at" = CURRENT_TIMESTAMP
      FROM candidate
      WHERE event."id" = candidate."id"
      RETURNING
        event."id",
        event."event_type" AS "eventType",
        event."event_version" AS "eventVersion",
        event."payload",
        event."organization_id" AS "organizationId",
        event."correlation_id" AS "correlationId",
        event."causation_id" AS "causationId",
        event."occurred_at" AS "occurredAt",
        event."attempt_count" AS "attemptNumber",
        event."max_attempts" AS "maxAttempts",
        event."lease_token" AS "leaseToken"
    `);

    return rows[0] ?? null;
  }

  async complete(event: ClaimedOutboxEvent): Promise<void> {
    const updated = await this.client.$executeRaw(Prisma.sql`
      UPDATE "outbox_events"
      SET
        "status" = 'PROCESSED',
        "locked_by" = NULL,
        "lease_token" = NULL,
        "locked_at" = NULL,
        "lock_expires_at" = NULL,
        "processed_at" = CURRENT_TIMESTAMP,
        "updated_at" = CURRENT_TIMESTAMP
      WHERE
        "id" = ${event.id}::uuid
        AND "status" = 'PROCESSING'
        AND "lease_token" = ${event.leaseToken}::uuid
    `);
    if (updated !== 1) {
      throw new OutboxLeaseLostError();
    }
  }

  async fail(input: FailClaimedOutboxEventInput): Promise<void> {
    const failure = safeFailure(input.failure);
    const retryAt =
      input.retryAt && input.event.attemptNumber < input.event.maxAttempts
        ? input.retryAt
        : null;
    if (retryAt && Number.isNaN(retryAt.getTime())) {
      throw new TypeError('Outbox retry timestamp must be a valid date');
    }

    const updated = retryAt
      ? await this.client.$executeRaw(Prisma.sql`
          UPDATE "outbox_events"
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
            "id" = ${input.event.id}::uuid
            AND "status" = 'PROCESSING'
            AND "lease_token" = ${input.event.leaseToken}::uuid
        `)
      : await this.client.$executeRaw(Prisma.sql`
          UPDATE "outbox_events"
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
            "id" = ${input.event.id}::uuid
            AND "status" = 'PROCESSING'
            AND "lease_token" = ${input.event.leaseToken}::uuid
        `);

    if (updated !== 1) {
      throw new OutboxLeaseLostError();
    }
  }
}
