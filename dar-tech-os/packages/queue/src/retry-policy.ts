export interface RetryPolicy {
  delayMs(attemptNumber: number): number;
}

export interface CappedExponentialRetryPolicyOptions {
  readonly baseDelayMs: number;
  readonly maxDelayMs: number;
}

export class CappedExponentialRetryPolicy implements RetryPolicy {
  private readonly baseDelayMs: number;
  private readonly maxDelayMs: number;

  constructor(options: CappedExponentialRetryPolicyOptions) {
    if (
      !Number.isSafeInteger(options.baseDelayMs) ||
      !Number.isSafeInteger(options.maxDelayMs) ||
      options.baseDelayMs <= 0 ||
      options.maxDelayMs < options.baseDelayMs
    ) {
      throw new RangeError(
        'Retry delays must be positive and maxDelayMs must cover baseDelayMs',
      );
    }

    this.baseDelayMs = options.baseDelayMs;
    this.maxDelayMs = options.maxDelayMs;
  }

  delayMs(attemptNumber: number): number {
    if (!Number.isSafeInteger(attemptNumber) || attemptNumber < 1) {
      throw new RangeError('Attempt number must be a positive integer');
    }

    const exponent = Math.min(attemptNumber - 1, 52);
    return Math.min(this.maxDelayMs, this.baseDelayMs * 2 ** exponent);
  }
}
