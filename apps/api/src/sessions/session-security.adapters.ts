import { Inject, Injectable } from '@nestjs/common';
import { STRUCTURED_LOGGER, type StructuredLogger } from '@dar-tech/observability';
import type {
  SessionAdministrationAuthorizationPort,
  SessionMetricsPort,
} from './session.contracts.js';

@Injectable()
export class DenyAllSessionAdministrationAuthorizationAdapter
  implements SessionAdministrationAuthorizationPort
{
  allows(
    _input: Parameters<SessionAdministrationAuthorizationPort['allows']>[0],
  ): Promise<boolean> {
    return Promise.resolve(false);
  }
}

@Injectable()
export class StructuredSessionMetricsAdapter implements SessionMetricsPort {
  constructor(@Inject(STRUCTURED_LOGGER) private readonly logger: StructuredLogger) {}

  record(input: Parameters<SessionMetricsPort['record']>[0]): void {
    this.logger.info('identity.session.metric', input);
  }
}
