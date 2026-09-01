export interface EnqueueJobInput {
  readonly queue: string;
  readonly name: string;
  readonly version: number;
  readonly payload: unknown;
  readonly organizationId?: string;
  readonly correlationId: string;
  readonly causationId?: string;
  readonly deduplicationKey?: string;
  readonly availableAt?: Date;
  readonly maxAttempts: number;
}

export interface EnqueueJobResult {
  readonly jobId: string;
  readonly deduplicated: boolean;
}

export interface ClaimJobOptions {
  readonly queue: string;
  readonly workerId: string;
  readonly leaseDurationMs: number;
}

export interface ClaimedJob {
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

export interface JobFailure {
  readonly code: string;
  readonly message: string;
}

export interface FailClaimedJobInput {
  readonly job: ClaimedJob;
  readonly failure: JobFailure;
  readonly retryAt: Date | null;
}

/**
 * Provider-port used by publishers and workers. A PostgreSQL implementation is
 * supplied in this package, while the application layer only depends on this contract.
 */
export interface JobQueuePort {
  enqueue(input: EnqueueJobInput): Promise<EnqueueJobResult>;
  claimNext(options: ClaimJobOptions): Promise<ClaimedJob | null>;
  complete(job: ClaimedJob): Promise<void>;
  fail(input: FailClaimedJobInput): Promise<void>;
}

export interface JobExecution<TPayload = unknown> extends ClaimedJob {
  readonly payload: TPayload;
}

export interface JobHandler<TPayload = unknown> {
  readonly name: string;
  readonly version: number;
  handle(job: JobExecution<TPayload>): Promise<void>;
}

export interface JobProcessingLogger {
  info(event: string, fields?: Readonly<Record<string, unknown>>): void;
  warnEvent(event: string, fields?: Readonly<Record<string, unknown>>): void;
  errorEvent(event: string, fields?: Readonly<Record<string, unknown>>): void;
}

export interface Clock {
  now(): Date;
}

export const systemClock: Clock = {
  now: () => new Date(),
};
