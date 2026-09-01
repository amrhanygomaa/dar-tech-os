export class JobExecutionError extends Error {
  constructor(
    readonly code: string,
    readonly retryable: boolean,
    readonly safeMessage = 'Job processing failed',
  ) {
    super(safeMessage);
    this.name = 'JobExecutionError';
  }
}

export class RetryableJobError extends JobExecutionError {
  constructor(code: string, safeMessage?: string) {
    super(code, true, safeMessage);
    this.name = 'RetryableJobError';
  }
}

export class NonRetryableJobError extends JobExecutionError {
  constructor(code: string, safeMessage?: string) {
    super(code, false, safeMessage);
    this.name = 'NonRetryableJobError';
  }
}

export class QueueLeaseLostError extends Error {
  constructor() {
    super('The queue job lease is no longer owned by this worker');
    this.name = 'QueueLeaseLostError';
  }
}

export class QueueDeduplicationConflictError extends Error {
  constructor() {
    super(
      'The queue deduplication key was already used for different job content',
    );
    this.name = 'QueueDeduplicationConflictError';
  }
}
