import { runInTransaction, type DatabaseClient } from '@dar-tech/database';
import type {
  EnqueueJobInput,
  JobExecution,
  JobHandler,
} from '@dar-tech/queue';
import { NonRetryableJobError } from '@dar-tech/queue';
import type {
  ClaimedOutboxEvent,
  OutboxEventEnvelope,
  OutboxLogger,
  OutboxRoute,
} from './contracts.js';
import type { OutboxConsumerRegistry } from './route-registry.js';

export const OUTBOX_DELIVERY_JOB = {
  name: 'foundation.outbox-delivery',
  version: 1,
} as const;

export interface OutboxDeliveryPayload {
  readonly consumerName: string;
  readonly event: {
    readonly id: string;
    readonly eventType: string;
    readonly eventVersion: number;
    readonly payload: unknown;
    readonly organizationId: string | null;
    readonly correlationId: string;
    readonly causationId: string | null;
    readonly occurredAt: string;
  };
}

export function createOutboxDeliveryJob(
  event: ClaimedOutboxEvent,
  route: OutboxRoute,
  maxAttempts: number,
): EnqueueJobInput {
  return {
    queue: route.queue,
    name: OUTBOX_DELIVERY_JOB.name,
    version: OUTBOX_DELIVERY_JOB.version,
    payload: {
      consumerName: route.consumerName,
      event: {
        id: event.id,
        eventType: event.eventType,
        eventVersion: event.eventVersion,
        payload: event.payload,
        organizationId: event.organizationId,
        correlationId: event.correlationId,
        causationId: event.causationId,
        occurredAt: event.occurredAt.toISOString(),
      },
    } satisfies OutboxDeliveryPayload,
    ...(event.organizationId ? { organizationId: event.organizationId } : {}),
    correlationId: event.correlationId,
    causationId: event.id,
    deduplicationKey: `outbox:${route.consumerName}:${event.id}`,
    maxAttempts,
  };
}

function parseDeliveryPayload(payload: unknown): {
  readonly consumerName: string;
  readonly event: OutboxEventEnvelope;
} {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    throw new NonRetryableJobError(
      'outbox.delivery_invalid_payload',
      'Outbox delivery payload is invalid',
    );
  }
  const candidate = payload as Partial<OutboxDeliveryPayload>;
  const event = candidate.event;
  if (
    typeof candidate.consumerName !== 'string' ||
    candidate.consumerName.length === 0 ||
    candidate.consumerName.length > 160 ||
    !event ||
    typeof event.id !== 'string' ||
    typeof event.eventType !== 'string' ||
    !Number.isSafeInteger(event.eventVersion) ||
    typeof event.correlationId !== 'string' ||
    typeof event.occurredAt !== 'string'
  ) {
    throw new NonRetryableJobError(
      'outbox.delivery_invalid_payload',
      'Outbox delivery payload is invalid',
    );
  }
  const occurredAt = new Date(event.occurredAt);
  if (Number.isNaN(occurredAt.getTime())) {
    throw new NonRetryableJobError(
      'outbox.delivery_invalid_payload',
      'Outbox delivery payload is invalid',
    );
  }

  return {
    consumerName: candidate.consumerName,
    event: {
      id: event.id,
      eventType: event.eventType,
      eventVersion: event.eventVersion,
      payload: event.payload,
      organizationId: event.organizationId ?? null,
      correlationId: event.correlationId,
      causationId: event.causationId ?? null,
      occurredAt,
    },
  };
}

export class OutboxDeliveryJobHandler implements JobHandler<OutboxDeliveryPayload> {
  readonly name = OUTBOX_DELIVERY_JOB.name;
  readonly version = OUTBOX_DELIVERY_JOB.version;

  constructor(
    private readonly client: DatabaseClient,
    private readonly consumers: OutboxConsumerRegistry,
    private readonly logger: OutboxLogger,
  ) {}

  async handle(job: JobExecution<OutboxDeliveryPayload>): Promise<void> {
    const delivery = parseDeliveryPayload(job.payload);
    const consumer = this.consumers.resolve(
      delivery.consumerName,
      delivery.event.eventType,
      delivery.event.eventVersion,
    );
    if (!consumer) {
      throw new NonRetryableJobError(
        'outbox.consumer_not_registered',
        'No consumer is registered for this outbox delivery',
      );
    }

    const processed = await runInTransaction(this.client, async (transaction) => {
      const receipt = await transaction.outboxConsumerReceipt.createMany({
        data: {
          eventId: delivery.event.id,
          consumerName: consumer.name,
          correlationId: delivery.event.correlationId,
        },
        skipDuplicates: true,
      });
      if (receipt.count === 0) {
        return false;
      }

      await consumer.handle(delivery.event, transaction, {
        attemptNumber: job.attemptNumber,
        maxAttempts: job.maxAttempts,
      });
      return true;
    });

    this.logger.info(
      processed ? 'outbox.consumer.processed' : 'outbox.consumer.duplicate_skipped',
      {
        eventId: delivery.event.id,
        consumerName: consumer.name,
        attemptNumber: job.attemptNumber,
      },
    );
  }
}
