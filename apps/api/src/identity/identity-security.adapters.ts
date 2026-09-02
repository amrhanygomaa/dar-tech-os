import { randomUUID } from 'node:crypto';
import { Inject, Injectable } from '@nestjs/common';
import { REQUEST_CONTEXT_STORE, type RequestContextStore } from '@dar-tech/observability';
import {
  AUDIT_EVENT_APPEND_PORT,
  type AuditEventAppendPort,
} from '../event-history/event-history.contracts.js';
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
export class DurableIdentityAuditHook implements IdentityAuditHook {
  constructor(
    @Inject(REQUEST_CONTEXT_STORE)
    private readonly contextStore: RequestContextStore,
    @Inject(AUDIT_EVENT_APPEND_PORT)
    private readonly auditEvents: AuditEventAppendPort,
  ) {}

  async record(
    entry: IdentityAuditEntry,
    transaction: Parameters<IdentityAuditHook['record']>[1],
  ): Promise<void> {
    const context = this.contextStore.get();
    await this.auditEvents.append(
      {
        organizationId: entry.organizationId,
        actionKey: entry.action,
        actorEmployeeId: entry.actor.employeeId,
        actorSnapshot: { type: 'employee', ...entry.actorSnapshot },
        targetType: entry.targetType,
        targetId: entry.targetId,
        targetSnapshot: entry.targetSnapshot,
        ...(context?.requestId ? { requestId: context.requestId } : {}),
        correlationId: context?.correlationId ?? randomUUID(),
        changeDelta: { changedFields: entry.changedFields },
        occurredAt: new Date(),
        eventVersion: 1,
        integrityVersion: 1,
      },
      transaction,
    );
  }
}
