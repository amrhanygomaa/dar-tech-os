import { type Prisma, type DatabaseTransaction } from '@dar-tech/database';
import { isValidCorrelationIdentifier } from '@dar-tech/observability';

const eventTypePattern = /^[a-z][a-z0-9]*(?:[._-][a-z0-9]+)+$/u;
const uuidPattern =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;

export interface PersistOutboxEventInput {
  readonly eventType: string;
  readonly eventVersion: number;
  readonly payload: unknown;
  readonly organizationId?: string;
  readonly correlationId: string;
  readonly causationId?: string;
  readonly occurredAt?: Date;
  readonly maxAttempts?: number;
}

function toJsonValue(payload: unknown): Prisma.InputJsonValue {
  const serialized = JSON.stringify(payload);
  if (serialized === undefined) {
    throw new TypeError('Outbox payload must be JSON-compatible');
  }
  return JSON.parse(serialized) as Prisma.InputJsonValue;
}

function assertInput(input: PersistOutboxEventInput): void {
  if (input.eventType.length > 200 || !eventTypePattern.test(input.eventType)) {
    throw new TypeError('Outbox event type is invalid');
  }
  if (!Number.isSafeInteger(input.eventVersion) || input.eventVersion < 1) {
    throw new TypeError('Outbox event version must be a positive integer');
  }
  if (!isValidCorrelationIdentifier(input.correlationId)) {
    throw new TypeError('Outbox correlation ID is invalid');
  }
  if (input.causationId && !isValidCorrelationIdentifier(input.causationId)) {
    throw new TypeError('Outbox causation ID is invalid');
  }
  if (input.organizationId && !uuidPattern.test(input.organizationId)) {
    throw new TypeError('Outbox organization ID is invalid');
  }
  if (
    input.maxAttempts !== undefined &&
    (!Number.isSafeInteger(input.maxAttempts) || input.maxAttempts < 1 || input.maxAttempts > 25)
  ) {
    throw new TypeError('Outbox maxAttempts must be between 1 and 25');
  }
  if (input.occurredAt && Number.isNaN(input.occurredAt.getTime())) {
    throw new TypeError('Outbox occurredAt must be a valid date');
  }
}

/** Must be called with the same Prisma transaction as the originating mutation. */
export async function persistOutboxEvent(
  transaction: DatabaseTransaction,
  input: PersistOutboxEventInput,
): Promise<{ readonly eventId: string }> {
  assertInput(input);
  const event = await transaction.outboxEvent.create({
    data: {
      eventType: input.eventType,
      eventVersion: input.eventVersion,
      payload: toJsonValue(input.payload),
      ...(input.organizationId ? { organizationId: input.organizationId } : {}),
      correlationId: input.correlationId,
      ...(input.causationId ? { causationId: input.causationId } : {}),
      ...(input.occurredAt ? { occurredAt: input.occurredAt } : {}),
      ...(input.maxAttempts ? { maxAttempts: input.maxAttempts } : {}),
    },
    select: { id: true },
  });
  return { eventId: event.id };
}
