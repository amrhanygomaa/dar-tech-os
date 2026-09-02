import { Inject, Injectable } from '@nestjs/common';
import {
  AUDIT_EVENT_READ_REPOSITORY_PORT,
  EVENT_HISTORY_ACTOR_PORT,
  EVENT_HISTORY_AUTHORIZATION_PORT,
  EVENT_HISTORY_READ_ACTIONS,
  SECURITY_EVENT_READ_REPOSITORY_PORT,
  type AuditEventFilters,
  type AuditEventReadRepositoryPort,
  type AuditEventView,
  type EventHistoryActor,
  type EventHistoryActorPort,
  type EventHistoryAuthorizationPort,
  type Page,
  type SecurityEventFilters,
  type SecurityEventReadRepositoryPort,
  type SecurityEventView,
} from './event-history.contracts.js';
import {
  eventHistoryAuthenticationRequired,
  eventHistoryAuthorizationDenied,
  eventHistoryNotFound,
} from './event-history.errors.js';

@Injectable()
export class EventHistoryService {
  constructor(
    @Inject(EVENT_HISTORY_ACTOR_PORT)
    private readonly actors: EventHistoryActorPort,
    @Inject(EVENT_HISTORY_AUTHORIZATION_PORT)
    private readonly authorization: EventHistoryAuthorizationPort,
    @Inject(AUDIT_EVENT_READ_REPOSITORY_PORT)
    private readonly auditEvents: AuditEventReadRepositoryPort,
    @Inject(SECURITY_EVENT_READ_REPOSITORY_PORT)
    private readonly securityEvents: SecurityEventReadRepositoryPort,
  ) {}

  async listAuditEvents(
    filters: AuditEventFilters,
    page: number,
    pageSize: number,
  ): Promise<Page<AuditEventView>> {
    const actor = await this.requireAuthorizedActor('audit-event');
    return this.auditEvents.list(actor.organizationId, filters, page, pageSize);
  }

  async getAuditEvent(id: string): Promise<AuditEventView> {
    const actor = await this.requireAuthorizedActor('audit-event', id);
    const event = await this.auditEvents.findById(actor.organizationId, id);
    if (!event) throw eventHistoryNotFound();
    return event;
  }

  async listSecurityEvents(
    filters: SecurityEventFilters,
    page: number,
    pageSize: number,
  ): Promise<Page<SecurityEventView>> {
    const actor = await this.requireAuthorizedActor('security-event');
    return this.securityEvents.list(actor.organizationId, filters, page, pageSize);
  }

  async getSecurityEvent(id: string): Promise<SecurityEventView> {
    const actor = await this.requireAuthorizedActor('security-event', id);
    const event = await this.securityEvents.findById(actor.organizationId, id);
    if (!event) throw eventHistoryNotFound();
    return event;
  }

  private async requireAuthorizedActor(
    type: 'audit-event' | 'security-event',
    id?: string,
  ): Promise<EventHistoryActor> {
    const actor = await this.actors.currentActor();
    if (!actor) throw eventHistoryAuthenticationRequired();
    const allowed = await this.authorization.authorize({
      actor,
      action:
        type === 'audit-event'
          ? EVENT_HISTORY_READ_ACTIONS.audit
          : EVENT_HISTORY_READ_ACTIONS.security,
      resource: {
        type,
        organizationId: actor.organizationId,
        ...(id ? { id } : {}),
      },
    });
    if (!allowed) throw eventHistoryAuthorizationDenied();
    return actor;
  }
}
