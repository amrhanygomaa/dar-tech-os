import type { DatabaseTransaction } from '@dar-tech/database';

export interface OutboxEventEnvelope {
  readonly id: string;
  readonly eventType: string;
  readonly eventVersion: number;
  readonly payload: unknown;
  readonly organizationId: string | null;
  readonly correlationId: string;
  readonly causationId: string | null;
  readonly occurredAt: Date;
}

export interface ClaimedOutboxEvent extends OutboxEventEnvelope {
  readonly attemptNumber: number;
  readonly maxAttempts: number;
  readonly leaseToken: string;
}

export interface ClaimOutboxOptions {
  readonly workerId: string;
  readonly leaseDurationMs: number;
}

export interface OutboxFailure {
  readonly code: string;
  readonly message: string;
}

export interface FailClaimedOutboxEventInput {
  readonly event: ClaimedOutboxEvent;
  readonly failure: OutboxFailure;
  readonly retryAt: Date | null;
}

export interface OutboxStorePort {
  claimNext(options: ClaimOutboxOptions): Promise<ClaimedOutboxEvent | null>;
  complete(event: ClaimedOutboxEvent): Promise<void>;
  fail(input: FailClaimedOutboxEventInput): Promise<void>;
}

export interface OutboxRoute {
  readonly eventType: string;
  readonly eventVersion: number;
  readonly consumerName: string;
  readonly queue: string;
}

export interface OutboxConsumerExecution {
  readonly attemptNumber: number;
  readonly maxAttempts: number;
}

export interface OutboxConsumer {
  readonly name: string;
  readonly eventType: string;
  readonly eventVersion: number;
  handle(
    event: OutboxEventEnvelope,
    transaction: DatabaseTransaction,
    execution: OutboxConsumerExecution,
  ): Promise<void>;
}

export interface OutboxLogger {
  info(event: string, fields?: Readonly<Record<string, unknown>>): void;
  warnEvent(event: string, fields?: Readonly<Record<string, unknown>>): void;
  errorEvent(event: string, fields?: Readonly<Record<string, unknown>>): void;
}
