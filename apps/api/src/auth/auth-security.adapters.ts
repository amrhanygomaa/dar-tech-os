import { randomUUID } from 'node:crypto';
import { Inject, Injectable } from '@nestjs/common';
import { DATABASE_CLIENT, type DatabaseClient } from '@dar-tech/database';
import {
  REQUEST_CONTEXT_STORE,
  STRUCTURED_LOGGER,
  type RequestContextStore,
  type StructuredLogger,
} from '@dar-tech/observability';
import {
  SECURITY_EVENT_APPEND_PORT,
  SECURITY_EVENT_TYPES,
  type HistoricalActorSnapshot,
  type SecurityEventAppendPort,
} from '../event-history/event-history.contracts.js';
import type {
  AuthenticationSecurityEvent,
  AuthenticationSecurityHook,
  InvitationAuthenticationEligibilityPort,
  InvitationAuthenticationAuthorization,
  NormalizedProviderIdentity,
} from './auth.contracts.js';

@Injectable()
export class DenyAllInvitationAuthenticationEligibilityAdapter implements InvitationAuthenticationEligibilityPort {
  authorize(
    _identity: NormalizedProviderIdentity,
  ): Promise<InvitationAuthenticationAuthorization | null> {
    return Promise.resolve(null);
  }
}

@Injectable()
export class DurableAuthenticationSecurityHook implements AuthenticationSecurityHook {
  constructor(
    @Inject(DATABASE_CLIENT) private readonly client: DatabaseClient,
    @Inject(SECURITY_EVENT_APPEND_PORT)
    private readonly securityEvents: SecurityEventAppendPort,
    @Inject(REQUEST_CONTEXT_STORE)
    private readonly contextStore: RequestContextStore,
    @Inject(STRUCTURED_LOGGER) private readonly logger: StructuredLogger,
  ) {}

  async record(event: AuthenticationSecurityEvent): Promise<void> {
    const requestContext = this.contextStore.get();
    const safeDimensions = {
      contract: event.contract,
      providerKey: event.providerKey,
      outcome: event.outcome,
      latencyMs: event.latencyMs,
      ...('failureCategory' in event ? { failureCategory: event.failureCategory } : {}),
    };
    if (event.outcome === 'succeeded') {
      const employee =
        event.principal.kind === 'linked_account'
          ? await this.client.employee.findFirst({
              where: {
                id: event.principal.employeeId,
                organizationId: event.principal.organizationId,
              },
              select: { displayName: true, employeeCode: true },
            })
          : null;
      const snapshot: HistoricalActorSnapshot = employee
        ? {
            type: 'employee',
            displayName: employee.displayName,
            employeeCode: employee.employeeCode,
          }
        : { type: 'unresolved' };
      await this.securityEvents.append({
        organizationId: event.principal.organizationId,
        eventType: SECURITY_EVENT_TYPES.authenticationSucceeded,
        category: 'authentication',
        risk: 'LOW',
        outcome: event.outcome,
        ...(event.principal.kind === 'linked_account'
          ? {
              actorEmployeeId: event.principal.employeeId,
              actorAccountId: event.principal.userAccountId,
            }
          : {}),
        providerKey: event.providerKey,
        actorSnapshot: snapshot,
        safeContext: {
          latencyMs: event.latencyMs,
          assuranceLevel: event.assuranceLevel,
          authenticatedAt: event.authenticatedAt?.toISOString() ?? null,
        },
        ...(requestContext?.requestId ? { requestId: requestContext.requestId } : {}),
        correlationId: requestContext?.correlationId ?? randomUUID(),
        occurredAt: event.authenticatedAt ?? new Date(),
        eventVersion: 1,
      });
      this.logger.info('identity.authentication.succeeded', safeDimensions);
    } else {
      await this.securityEvents.append({
        eventType: SECURITY_EVENT_TYPES.authenticationFailed,
        category: 'authentication',
        risk: 'MEDIUM',
        outcome: event.outcome,
        providerKey: event.providerKey,
        safeContext: {
          failureCategory: event.failureCategory,
          latencyMs: event.latencyMs,
        },
        ...(requestContext?.requestId ? { requestId: requestContext.requestId } : {}),
        correlationId: requestContext?.correlationId ?? randomUUID(),
        occurredAt: new Date(),
        eventVersion: 1,
      });
      this.logger.warnEvent('identity.authentication.failed', safeDimensions);
    }
  }
}
