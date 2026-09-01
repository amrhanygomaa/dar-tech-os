import { RequestMethod, type INestApplication } from '@nestjs/common';
import {
  RequestContextMiddleware,
  type RequestContextStore,
  type StructuredLogger,
} from '@dar-tech/observability';
import { ApiExceptionFilter } from './api-exception.filter.js';
import { ApiResponseInterceptor } from './api-response.interceptor.js';
import { configureOpenApi } from './configure-openapi.js';

export function configureApiFoundation(
  app: INestApplication,
  contextStore: RequestContextStore,
  logger: StructuredLogger,
): void {
  const requestContextMiddleware = app.get(RequestContextMiddleware);
  app.use(requestContextMiddleware.use.bind(requestContextMiddleware));
  app.setGlobalPrefix('api/v1', {
    exclude: [
      { path: 'health', method: RequestMethod.GET },
      { path: 'health/live', method: RequestMethod.GET },
      { path: 'health/ready', method: RequestMethod.GET },
    ],
  });
  app.useGlobalFilters(new ApiExceptionFilter(contextStore, logger));
  app.useGlobalInterceptors(new ApiResponseInterceptor(contextStore));
  configureOpenApi(app);
}
