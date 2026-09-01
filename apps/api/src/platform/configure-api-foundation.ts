import type { INestApplication } from '@nestjs/common';
import {
  RequestContextMiddleware,
  type RequestContextStore,
  type StructuredLogger,
} from '@dar-tech/observability';
import { ApiExceptionFilter } from './api-exception.filter.js';
import { ApiResponseInterceptor } from './api-response.interceptor.js';

export function configureApiFoundation(
  app: INestApplication,
  contextStore: RequestContextStore,
  logger: StructuredLogger,
): void {
  const requestContextMiddleware = app.get(RequestContextMiddleware);
  app.use(requestContextMiddleware.use.bind(requestContextMiddleware));
  app.setGlobalPrefix('api/v1');
  app.useGlobalFilters(new ApiExceptionFilter(contextStore, logger));
  app.useGlobalInterceptors(new ApiResponseInterceptor(contextStore));
}
