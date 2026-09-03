import { Inject, Injectable } from '@nestjs/common';
import { STRUCTURED_LOGGER, type StructuredLogger } from '@dar-tech/observability';
import type { AuthorizationMetricsPort } from './authorization.contracts.js';

@Injectable()
export class StructuredAuthorizationMetricsAdapter implements AuthorizationMetricsPort {
  constructor(@Inject(STRUCTURED_LOGGER) private readonly logger: StructuredLogger) {}

  record(input: Parameters<AuthorizationMetricsPort['record']>[0]): void {
    this.logger.info('authorization.decision.metric', input);
  }
}
