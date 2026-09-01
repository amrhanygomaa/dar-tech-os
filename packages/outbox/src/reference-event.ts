import type { DatabaseTransaction } from '@dar-tech/database';
import { NonRetryableJobError, RetryableJobError } from '@dar-tech/queue';
import type {
  OutboxConsumer,
  OutboxConsumerExecution,
  OutboxEventEnvelope,
  OutboxRoute,
} from './contracts.js';
import { persistOutboxEvent } from './outbox-writer.js';

export const REFERENCE_OUTBOX_EVENT = {
  eventType: 'foundation.reference-event',
  eventVersion: 1,
  consumerName: 'foundation.reference-consumer',
  queue: 'foundation',
} as const;

export const REFERENCE_OUTBOX_ROUTE: OutboxRoute = {
  eventType: REFERENCE_OUTBOX_EVENT.eventType,
  eventVersion: REFERENCE_OUTBOX_EVENT.eventVersion,
  consumerName: REFERENCE_OUTBOX_EVENT.consumerName,
  queue: REFERENCE_OUTBOX_EVENT.queue,
};

export interface ReferenceOutboxPayload {
  readonly referenceId: string;
  readonly failuresBeforeSuccess: number;
}

export interface CreateReferenceOutboxEventInput extends ReferenceOutboxPayload {
  readonly correlationId: string;
  readonly maxAttempts?: number;
}

export function createReferenceOutboxEvent(
  transaction: DatabaseTransaction,
  input: CreateReferenceOutboxEventInput,
): Promise<{ readonly eventId: string }> {
  return persistOutboxEvent(transaction, {
    eventType: REFERENCE_OUTBOX_EVENT.eventType,
    eventVersion: REFERENCE_OUTBOX_EVENT.eventVersion,
    payload: {
      referenceId: input.referenceId,
      failuresBeforeSuccess: input.failuresBeforeSuccess,
    },
    correlationId: input.correlationId,
    ...(input.maxAttempts ? { maxAttempts: input.maxAttempts } : {}),
  });
}

function parsePayload(payload: unknown): ReferenceOutboxPayload {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    throw new NonRetryableJobError(
      'foundation.reference_event_invalid_payload',
      'Reference outbox event payload is invalid',
    );
  }
  const candidate = payload as Readonly<Record<string, unknown>>;
  if (
    typeof candidate.referenceId !== 'string' ||
    !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u.test(candidate.referenceId) ||
    !Number.isSafeInteger(candidate.failuresBeforeSuccess) ||
    (candidate.failuresBeforeSuccess as number) < 0 ||
    (candidate.failuresBeforeSuccess as number) > 24
  ) {
    throw new NonRetryableJobError(
      'foundation.reference_event_invalid_payload',
      'Reference outbox event payload is invalid',
    );
  }
  return {
    referenceId: candidate.referenceId,
    failuresBeforeSuccess: candidate.failuresBeforeSuccess as number,
  };
}

/** Technical consumer whose only durable side effect is its idempotency receipt. */
export class ReferenceOutboxConsumer implements OutboxConsumer {
  readonly name = REFERENCE_OUTBOX_EVENT.consumerName;
  readonly eventType = REFERENCE_OUTBOX_EVENT.eventType;
  readonly eventVersion = REFERENCE_OUTBOX_EVENT.eventVersion;

  async handle(
    event: OutboxEventEnvelope,
    _transaction: DatabaseTransaction,
    execution: OutboxConsumerExecution,
  ): Promise<void> {
    const payload = parsePayload(event.payload);
    if (execution.attemptNumber <= payload.failuresBeforeSuccess) {
      throw new RetryableJobError(
        'foundation.reference_event_requested_failure',
        'Reference outbox consumer requested a controlled failure',
      );
    }
  }
}
