import { Inject, Injectable } from '@nestjs/common';
import {
  REQUEST_CONTEXT_STORE,
  STRUCTURED_LOGGER,
  type RequestContextStore,
  type StructuredLogger,
} from '@dar-tech/observability';
import type {
  AuthenticatedActorPort,
  IdentityAuditEntry,
  IdentityAuditHook,
  IdentityAuthorizationPort,
  IdentityAuthorizationRequest,
  TrustedActor,
} from './identity.contracts.js';

@Injectable()
export class DenyAllAuthenticatedActorAdapter implements AuthenticatedActorPort {
  currentActor(): Promise<TrustedActor | null> {
    return Promise.resolve(null);
  }
}

@Injectable()
export class DenyAllIdentityAuthorizationAdapter implements IdentityAuthorizationPort {
  authorize(_request: IdentityAuthorizationRequest): Promise<boolean> {
    return Promise.resolve(false);
  }
}

@Injectable()
export class StructuredIdentityAuditHook implements IdentityAuditHook {
  constructor(
    @Inject(REQUEST_CONTEXT_STORE) private readonly contextStore: RequestContextStore,
    @Inject(STRUCTURED_LOGGER) private readonly logger: StructuredLogger,
  ) {}

  record(entry: IdentityAuditEntry): Promise<void> {
    const context = this.contextStore.get();
    this.logger.info('identity.audit.hook_recorded', {
      action: entry.action,
      actorEmployeeId: entry.actor.employeeId,
      organizationId: entry.organizationId,
      targetType: entry.targetType,
      targetId: entry.targetId,
      changedFields: entry.changedFields,
      ...(context?.requestId ? { requestIdPresent: true } : {}),
      correlationIdPresent: context?.correlationId !== undefined,
      persistenceOwner: 'S02-T12',
    });
    return Promise.resolve();
  }
}
