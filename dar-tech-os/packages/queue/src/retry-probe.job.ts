import type { EnqueueJobInput, JobExecution, JobHandler } from './contracts.js';
import { NonRetryableJobError, RetryableJobError } from './errors.js';

export const RETRY_PROBE_JOB = {
  queue: 'foundation',
  name: 'foundation.retry-probe',
  version: 1,
} as const;

export interface RetryProbePayload {
  readonly probeId: string;
  readonly failuresBeforeSuccess: number;
}

function parsePayload(payload: unknown): RetryProbePayload {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    throw new NonRetryableJobError(
      'foundation.retry_probe_invalid_payload',
      'Retry probe payload is invalid',
    );
  }

  const candidate = payload as Readonly<Record<string, unknown>>;
  if (
    typeof candidate.probeId !== 'string' ||
    !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u.test(candidate.probeId) ||
    !Number.isSafeInteger(candidate.failuresBeforeSuccess) ||
    (candidate.failuresBeforeSuccess as number) < 0 ||
    (candidate.failuresBeforeSuccess as number) > 24
  ) {
    throw new NonRetryableJobError(
      'foundation.retry_probe_invalid_payload',
      'Retry probe payload is invalid',
    );
  }

  return {
    probeId: candidate.probeId,
    failuresBeforeSuccess: candidate.failuresBeforeSuccess as number,
  };
}

/** A technical-only handler used to prove retry behavior without a business domain. */
export class RetryProbeJobHandler implements JobHandler<RetryProbePayload> {
  readonly name = RETRY_PROBE_JOB.name;
  readonly version = RETRY_PROBE_JOB.version;

  async handle(job: JobExecution<RetryProbePayload>): Promise<void> {
    const payload = parsePayload(job.payload);
    if (job.attemptNumber <= payload.failuresBeforeSuccess) {
      throw new RetryableJobError(
        'foundation.retry_probe_requested_failure',
        'Retry probe requested a controlled failure',
      );
    }
  }
}

export interface CreateRetryProbeJobOptions {
  readonly probeId: string;
  readonly failuresBeforeSuccess: number;
  readonly correlationId: string;
  readonly deduplicationKey?: string;
  readonly maxAttempts: number;
}

export function createRetryProbeJob(
  options: CreateRetryProbeJobOptions,
): EnqueueJobInput {
  return {
    queue: RETRY_PROBE_JOB.queue,
    name: RETRY_PROBE_JOB.name,
    version: RETRY_PROBE_JOB.version,
    payload: {
      probeId: options.probeId,
      failuresBeforeSuccess: options.failuresBeforeSuccess,
    },
    correlationId: options.correlationId,
    ...(options.deduplicationKey
      ? { deduplicationKey: options.deduplicationKey }
      : {}),
    maxAttempts: options.maxAttempts,
  };
}
