import type { RequestContextStore } from '@dar-tech/observability';
import type {
  ClaimJobOptions,
  Clock,
  JobFailure,
  JobProcessingLogger,
  JobQueuePort,
} from './contracts.js';
import { JobExecutionError, NonRetryableJobError } from './errors.js';
import type { JobHandlerRegistry } from './job-handler-registry.js';
import type { RetryPolicy } from './retry-policy.js';

export interface JobProcessorOptions extends ClaimJobOptions {}

function normalizedFailure(error: unknown): {
  readonly failure: JobFailure;
  readonly retryable: boolean;
} {
  if (error instanceof JobExecutionError) {
    return {
      failure: {
        code: error.code.slice(0, 128),
        message: error.safeMessage.slice(0, 2_048),
      },
      retryable: error.retryable,
    };
  }

  return {
    failure: {
      code: 'queue.handler_failed',
      message: 'Job processing failed',
    },
    retryable: true,
  };
}

export class JobProcessor {
  constructor(
    private readonly queue: JobQueuePort,
    private readonly handlers: JobHandlerRegistry,
    private readonly contextStore: RequestContextStore,
    private readonly logger: JobProcessingLogger,
    private readonly retryPolicy: RetryPolicy,
    private readonly clock: Clock,
  ) {}

  /** Claims and processes at most one job, allowing a polling host to remain replaceable. */
  async processNext(options: JobProcessorOptions): Promise<boolean> {
    const job = await this.queue.claimNext(options);
    if (!job) {
      return false;
    }

    return this.contextStore.run(
      {
        runtime: 'worker',
        jobId: job.id,
        correlationId: job.correlationId,
      },
      async () => {
        this.logger.info('queue.job.processing_started', {
          jobName: job.name,
          jobVersion: job.version,
          attemptNumber: job.attemptNumber,
          maxAttempts: job.maxAttempts,
        });

        try {
          const handler = this.handlers.resolve(job.name, job.version);
          if (!handler) {
            throw new NonRetryableJobError(
              'queue.handler_not_registered',
              'No handler is registered for this job type',
            );
          }

          await handler.handle(job);
          await this.queue.complete(job);
          this.logger.info('queue.job.processing_succeeded', {
            jobName: job.name,
            attemptNumber: job.attemptNumber,
          });
        } catch (error: unknown) {
          const normalized = normalizedFailure(error);
          const shouldRetry =
            normalized.retryable && job.attemptNumber < job.maxAttempts;
          const retryDelayMs = shouldRetry
            ? this.retryPolicy.delayMs(job.attemptNumber)
            : null;
          const retryAt =
            retryDelayMs === null
              ? null
              : new Date(this.clock.now().getTime() + retryDelayMs);

          await this.queue.fail({
            job,
            failure: normalized.failure,
            retryAt,
          });

          const fields = {
            jobName: job.name,
            attemptNumber: job.attemptNumber,
            failureCode: normalized.failure.code,
            retryScheduled: retryAt !== null,
            ...(retryDelayMs === null ? {} : { retryDelayMs }),
          };
          if (retryAt) {
            this.logger.warnEvent('queue.job.retry_scheduled', fields);
          } else {
            this.logger.errorEvent('queue.job.processing_failed', fields);
          }
        }

        return true;
      },
    );
  }
}
