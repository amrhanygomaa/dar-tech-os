import { Inject, Injectable } from '@nestjs/common';
import { STRUCTURED_LOGGER, type StructuredLogger } from '@dar-tech/observability';
import type {
  AuthenticationSecurityEvent,
  AuthenticationSecurityHook,
  InvitationAuthenticationEligibilityPort,
  InvitationAuthenticationAuthorization,
  NormalizedProviderIdentity,
} from './auth.contracts.js';

@Injectable()
export class DenyAllInvitationAuthenticationEligibilityAdapter
  implements InvitationAuthenticationEligibilityPort
{
  authorize(
    _identity: NormalizedProviderIdentity,
  ): Promise<InvitationAuthenticationAuthorization | null> {
    return Promise.resolve(null);
  }
}

@Injectable()
export class StructuredAuthenticationSecurityHook implements AuthenticationSecurityHook {
  constructor(@Inject(STRUCTURED_LOGGER) private readonly logger: StructuredLogger) {}

  record(event: AuthenticationSecurityEvent): Promise<void> {
    const safeDimensions = {
      contract: event.contract,
      providerKey: event.providerKey,
      outcome: event.outcome,
      latencyMs: event.latencyMs,
      ...('failureCategory' in event ? { failureCategory: event.failureCategory } : {}),
      persistenceOwner: 'S02-T12',
    };
    if (event.outcome === 'succeeded') {
      this.logger.info('identity.authentication.succeeded', safeDimensions);
    } else {
      this.logger.warnEvent('identity.authentication.failed', safeDimensions);
    }
    return Promise.resolve();
  }
}
