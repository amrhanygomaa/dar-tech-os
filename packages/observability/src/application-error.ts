import type { ApiErrorCode } from '@dar-tech/types';

export class ApplicationError extends Error {
  constructor(
    readonly code: ApiErrorCode,
    readonly statusCode: number,
    readonly safeMessage: string,
    options?: ErrorOptions,
  ) {
    super(safeMessage, options);
    this.name = 'ApplicationError';
  }
}
