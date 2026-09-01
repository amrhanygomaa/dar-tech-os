import type { CallHandler, ExecutionContext, NestInterceptor } from '@nestjs/common';
import type { Response } from 'express';
import type { Observable } from 'rxjs';
import { map } from 'rxjs/operators';
import type { ApiSuccessResponse } from '@dar-tech/types';
import { createRequestIdentifiers, type RequestContextStore } from '@dar-tech/observability';

export class ApiResponseInterceptor<T>
  implements NestInterceptor<T, ApiSuccessResponse<T>>
{
  constructor(private readonly contextStore: RequestContextStore) {}

  intercept(_context: ExecutionContext, next: CallHandler<T>): Observable<ApiSuccessResponse<T>> {
    const activeContext = this.contextStore.get();
    const fallbackIdentifiers = activeContext?.requestId
      ? undefined
      : createRequestIdentifiers(undefined, undefined);
    const requestId = activeContext?.requestId ?? fallbackIdentifiers!.requestId;
    if (fallbackIdentifiers) {
      const response = _context.switchToHttp().getResponse<Response>();
      response.setHeader('X-Request-ID', fallbackIdentifiers.requestId);
      response.setHeader('X-Correlation-ID', fallbackIdentifiers.correlationId);
    }

    return next.handle().pipe(
      map((data) => ({
        data,
        meta: { requestId },
      })),
    );
  }
}
