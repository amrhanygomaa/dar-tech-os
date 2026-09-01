import { Inject, Injectable, type NestMiddleware } from '@nestjs/common';
import type { NextFunction, Request, Response } from 'express';
import {
  CORRELATION_ID_HEADER,
  REQUEST_ID_HEADER,
  createRequestIdentifiers,
} from './correlation.js';
import { REQUEST_CONTEXT_STORE, STRUCTURED_LOGGER } from './tokens.js';
import type { RequestContextStore } from './request-context.js';
import type { StructuredLogger } from './logger.js';

@Injectable()
export class RequestContextMiddleware implements NestMiddleware {
  constructor(
    @Inject(REQUEST_CONTEXT_STORE) private readonly contextStore: RequestContextStore,
    @Inject(STRUCTURED_LOGGER) private readonly logger: StructuredLogger,
  ) {}

  use(request: Request, response: Response, next: NextFunction): void {
    const identifiers = createRequestIdentifiers(
      request.headers[REQUEST_ID_HEADER],
      request.headers[CORRELATION_ID_HEADER],
    );
    const startedAt = process.hrtime.bigint();

    response.setHeader('X-Request-ID', identifiers.requestId);
    response.setHeader('X-Correlation-ID', identifiers.correlationId);

    this.contextStore.run(
      { ...identifiers, runtime: 'api' },
      () => {
        this.logger.info('http.request.started', {
          method: request.method,
          path: request.path,
        });

        response.once('finish', () => {
          const durationMs = Number(process.hrtime.bigint() - startedAt) / 1_000_000;
          this.logger.info('http.request.completed', {
            method: request.method,
            path: request.path,
            statusCode: response.statusCode,
            durationMs: Math.round(durationMs * 100) / 100,
          });
        });

        next();
      },
    );
  }
}
