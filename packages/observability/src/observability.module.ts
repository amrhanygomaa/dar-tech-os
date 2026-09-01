import { type DynamicModule, Module } from '@nestjs/common';
import { RequestContextMiddleware } from './http-middleware.js';
import type { StructuredLogger } from './logger.js';
import type { RequestContextStore } from './request-context.js';
import { REQUEST_CONTEXT_STORE, STRUCTURED_LOGGER } from './tokens.js';

export interface ObservabilityRegistration {
  readonly contextStore: RequestContextStore;
  readonly logger: StructuredLogger;
}

@Module({})
export class ObservabilityModule {
  static register(registration: ObservabilityRegistration): DynamicModule {
    return {
      module: ObservabilityModule,
      global: true,
      providers: [
        RequestContextMiddleware,
        { provide: REQUEST_CONTEXT_STORE, useValue: registration.contextStore },
        { provide: STRUCTURED_LOGGER, useValue: registration.logger },
      ],
      exports: [REQUEST_CONTEXT_STORE, STRUCTURED_LOGGER],
    };
  }

}
