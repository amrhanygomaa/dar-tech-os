import { Inject, Injectable } from '@nestjs/common';
import {
  DATABASE_CLIENT,
  type DatabaseClient,
  type DatabaseTransaction,
  type Prisma,
} from '@dar-tech/database';
import { STRUCTURED_LOGGER, type StructuredLogger } from '@dar-tech/observability';
import {
  EVENT_HISTORY_METRICS_PORT,
  type AuditEventAppendInput,
  type AuditEventAppendPort,
  type AuditEventFilters,
  type AuditEventReadRepositoryPort,
  type AuditEventView,
  type EventHistoryMetricsPort,
  type EventRisk,
  type HistoricalActorSnapshot,
  type HistoricalTargetSnapshot,
  type Page,
  type SafeAuditDelta,
  type SafeSecurityContext,
  type SecurityEventAppendInput,
  type SecurityEventAppendPort,
  type SecurityEventFilters,
  type SecurityEventReadRepositoryPort,
  type SecurityEventView,
} from './event-history.contracts.js';
import { validateAuditEventAppend, validateSecurityEventAppend } from './event-history-input.js';

const auditSelect = {
  id: true,
  organizationId: true,
  actionKey: true,
  actorEmployeeId: true,
  actorSnapshot: true,
  targetType: true,
  targetId: true,
  targetSnapshot: true,
  requestId: true,
  correlationId: true,
  sessionReference: true,
  safeReason: true,
  changeDelta: true,
  approvalReference: true,
  occurredAt: true,
  createdAt: true,
  eventVersion: true,
  integrityVersion: true,
} satisfies Prisma.AuditEventSelect;

const securitySelect = {
  id: true,
  organizationId: true,
  eventType: true,
  category: true,
  risk: true,
  outcome: true,
  actorEmployeeId: true,
  actorAccountId: true,
  providerKey: true,
  sessionReference: true,
  actorSnapshot: true,
  safeContext: true,
  requestId: true,
  correlationId: true,
  networkContext: true,
  deviceContext: true,
  occurredAt: true,
  createdAt: true,
  eventVersion: true,
} satisfies Prisma.SecurityEventSelect;

type RawAuditEvent = Prisma.AuditEventGetPayload<{
  select: typeof auditSelect;
}>;
type RawSecurityEvent = Prisma.SecurityEventGetPayload<{
  select: typeof securitySelect;
}>;

function objectValue(value: Prisma.JsonValue | null): Record<string, Prisma.JsonValue> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, Prisma.JsonValue>)
    : null;
}

function optionalString(value: Prisma.JsonValue | undefined, maximum: number): string | undefined {
  return typeof value === 'string' && value.length > 0 && value.length <= maximum
    ? value
    : undefined;
}

function actorSnapshot(value: Prisma.JsonValue): HistoricalActorSnapshot {
  const snapshot = objectValue(value);
  const type = snapshot?.type;
  const safeType =
    type === 'employee' || type === 'system' || type === 'unresolved' ? type : 'unresolved';
  const displayName = optionalString(snapshot?.displayName, 160);
  const employeeCode = optionalString(snapshot?.employeeCode, 64);
  return {
    type: safeType,
    ...(displayName ? { displayName } : {}),
    ...(employeeCode ? { employeeCode } : {}),
  };
}

function targetSnapshot(value: Prisma.JsonValue | null): HistoricalTargetSnapshot | undefined {
  const snapshot = objectValue(value);
  if (!snapshot) return undefined;
  const displayName = optionalString(snapshot.displayName, 160);
  const employeeCode = optionalString(snapshot.employeeCode, 64);
  if (!displayName && !employeeCode) return undefined;
  return {
    ...(displayName ? { displayName } : {}),
    ...(employeeCode ? { employeeCode } : {}),
  };
}

function safeDelta(value: Prisma.JsonValue | null): SafeAuditDelta | undefined {
  const delta = objectValue(value);
  if (!delta || !Array.isArray(delta.changedFields)) return undefined;
  const changedFields = delta.changedFields.filter(
    (field): field is string => typeof field === 'string' && field.length <= 64,
  );
  return changedFields.length > 0 ? { changedFields } : undefined;
}

function safeContext(value: Prisma.JsonValue | null): SafeSecurityContext | undefined {
  const context = objectValue(value);
  if (!context) return undefined;
  const safeEntries = Object.entries(context).filter(
    ([key, nested]) =>
      key.length <= 64 &&
      !/(?:password|secret|token|nonce|state|authorization|email|subject|stack|raw|payload|login.?hint|code)/iu.test(
        key,
      ) &&
      (nested === null ||
        typeof nested === 'boolean' ||
        typeof nested === 'number' ||
        (typeof nested === 'string' && nested.length <= 256)),
  );
  return Object.fromEntries(safeEntries) as SafeSecurityContext;
}

function networkContext(value: Prisma.JsonValue | null): SecurityEventView['networkContext'] {
  const context = objectValue(value);
  if (!context) return undefined;
  const countryCode = optionalString(context.countryCode, 2);
  const ipPrefix = optionalString(context.ipPrefix, 64);
  return {
    ...(countryCode ? { countryCode } : {}),
    ...(ipPrefix ? { ipPrefix } : {}),
  };
}

function deviceContext(value: Prisma.JsonValue | null): SecurityEventView['deviceContext'] {
  const context = objectValue(value);
  if (!context) return undefined;
  const deviceClass = optionalString(context.deviceClass, 32);
  const userAgentFamily = optionalString(context.userAgentFamily, 64);
  return {
    ...(deviceClass ? { deviceClass } : {}),
    ...(userAgentFamily ? { userAgentFamily } : {}),
  };
}

function auditView(event: RawAuditEvent): AuditEventView {
  const snapshot = targetSnapshot(event.targetSnapshot);
  const delta = safeDelta(event.changeDelta);
  return {
    id: event.id,
    organizationId: event.organizationId,
    actionKey: event.actionKey as AuditEventView['actionKey'],
    actorEmployeeId: event.actorEmployeeId,
    actorSnapshot: actorSnapshot(event.actorSnapshot),
    targetType: event.targetType,
    targetId: event.targetId,
    ...(snapshot ? { targetSnapshot: snapshot } : {}),
    requestId: event.requestId,
    correlationId: event.correlationId,
    sessionReference: event.sessionReference,
    safeReason: event.safeReason,
    ...(delta ? { changeDelta: delta } : {}),
    approvalReference: event.approvalReference,
    occurredAt: event.occurredAt,
    createdAt: event.createdAt,
    eventVersion: event.eventVersion,
    integrityVersion: event.integrityVersion,
  };
}

function securityView(event: RawSecurityEvent): SecurityEventView {
  const snapshot = event.actorSnapshot ? actorSnapshot(event.actorSnapshot) : undefined;
  const context = safeContext(event.safeContext);
  const network = networkContext(event.networkContext);
  const device = deviceContext(event.deviceContext);
  return {
    id: event.id,
    organizationId: event.organizationId,
    eventType: event.eventType as SecurityEventView['eventType'],
    category: event.category,
    risk: event.risk as EventRisk,
    outcome: event.outcome,
    actorEmployeeId: event.actorEmployeeId,
    actorAccountId: event.actorAccountId,
    providerKey: event.providerKey,
    sessionReference: event.sessionReference,
    ...(snapshot ? { actorSnapshot: snapshot } : {}),
    ...(context ? { safeContext: context } : {}),
    requestId: event.requestId,
    correlationId: event.correlationId,
    ...(network ? { networkContext: network } : {}),
    ...(device ? { deviceContext: device } : {}),
    occurredAt: event.occurredAt,
    createdAt: event.createdAt,
    eventVersion: event.eventVersion,
  };
}

@Injectable()
export class PrismaEventHistoryRepository {
  constructor(
    @Inject(DATABASE_CLIENT) private readonly client: DatabaseClient,
    @Inject(EVENT_HISTORY_METRICS_PORT)
    private readonly metrics: EventHistoryMetricsPort,
    @Inject(STRUCTURED_LOGGER) private readonly logger: StructuredLogger,
  ) {}

  async appendAudit(
    rawInput: AuditEventAppendInput,
    transaction?: DatabaseTransaction,
  ): Promise<AuditEventView> {
    const input = validateAuditEventAppend(rawInput);
    const database = transaction ?? this.client;
    try {
      const event = await database.auditEvent.create({
        data: {
          ...(input.organizationId ? { organizationId: input.organizationId } : {}),
          actionKey: input.actionKey,
          ...(input.actorEmployeeId ? { actorEmployeeId: input.actorEmployeeId } : {}),
          actorSnapshot: input.actorSnapshot as unknown as Prisma.InputJsonValue,
          targetType: input.targetType,
          targetId: input.targetId,
          ...(input.targetSnapshot
            ? { targetSnapshot: input.targetSnapshot as Prisma.InputJsonValue }
            : {}),
          ...(input.requestId ? { requestId: input.requestId } : {}),
          correlationId: input.correlationId,
          ...(input.sessionReference ? { sessionReference: input.sessionReference } : {}),
          ...(input.safeReason ? { safeReason: input.safeReason } : {}),
          ...(input.changeDelta
            ? {
                changeDelta: input.changeDelta as unknown as Prisma.InputJsonValue,
              }
            : {}),
          ...(input.approvalReference ? { approvalReference: input.approvalReference } : {}),
          ...(input.occurredAt ? { occurredAt: input.occurredAt } : {}),
          ...(input.eventVersion ? { eventVersion: input.eventVersion } : {}),
          ...(input.integrityVersion ? { integrityVersion: input.integrityVersion } : {}),
        },
        select: auditSelect,
      });
      this.metrics.recordWrite('audit', 'succeeded');
      this.metrics.recordVolume({
        kind: 'audit',
        category: input.actionKey,
        outcome: 'recorded',
      });
      this.logger.info('eventhistory.audit.persisted', { eventId: event.id });
      return auditView(event);
    } catch (error) {
      this.metrics.recordWrite('audit', 'failed');
      this.logger.errorEvent('eventhistory.audit.persistence_failed', {
        actionKey: input.actionKey,
        errorCategory: error instanceof Error ? error.name : 'unknown',
      });
      throw error;
    }
  }

  async appendSecurity(
    rawInput: SecurityEventAppendInput,
    transaction?: DatabaseTransaction,
  ): Promise<SecurityEventView> {
    const input = validateSecurityEventAppend(rawInput);
    const database = transaction ?? this.client;
    try {
      const event = await database.securityEvent.create({
        data: {
          ...(input.organizationId ? { organizationId: input.organizationId } : {}),
          eventType: input.eventType,
          category: input.category,
          risk: input.risk,
          outcome: input.outcome,
          ...(input.actorEmployeeId ? { actorEmployeeId: input.actorEmployeeId } : {}),
          ...(input.actorAccountId ? { actorAccountId: input.actorAccountId } : {}),
          ...(input.providerKey ? { providerKey: input.providerKey } : {}),
          ...(input.sessionReference ? { sessionReference: input.sessionReference } : {}),
          ...(input.actorSnapshot
            ? {
                actorSnapshot: input.actorSnapshot as unknown as Prisma.InputJsonValue,
              }
            : {}),
          ...(input.safeContext ? { safeContext: input.safeContext as Prisma.InputJsonValue } : {}),
          ...(input.requestId ? { requestId: input.requestId } : {}),
          correlationId: input.correlationId,
          ...(input.networkContext
            ? { networkContext: input.networkContext as Prisma.InputJsonValue }
            : {}),
          ...(input.deviceContext
            ? { deviceContext: input.deviceContext as Prisma.InputJsonValue }
            : {}),
          ...(input.occurredAt ? { occurredAt: input.occurredAt } : {}),
          ...(input.eventVersion ? { eventVersion: input.eventVersion } : {}),
        },
        select: securitySelect,
      });
      this.metrics.recordWrite('security', 'succeeded');
      this.metrics.recordVolume({
        kind: 'security',
        category: input.category,
        outcome: input.outcome,
        risk: input.risk,
      });
      this.logger.info('eventhistory.security.persisted', {
        eventId: event.id,
      });
      return securityView(event);
    } catch (error) {
      this.metrics.recordWrite('security', 'failed');
      this.logger.errorEvent('eventhistory.security.persistence_failed', {
        eventType: input.eventType,
        category: input.category,
        outcome: input.outcome,
        risk: input.risk,
        errorCategory: error instanceof Error ? error.name : 'unknown',
      });
      throw error;
    }
  }

  async listAudit(
    organizationId: string,
    filters: AuditEventFilters,
    page: number,
    pageSize: number,
  ): Promise<Page<AuditEventView>> {
    const where: Prisma.AuditEventWhereInput = {
      organizationId,
      ...(filters.actionKey ? { actionKey: filters.actionKey } : {}),
      ...(filters.targetType ? { targetType: filters.targetType } : {}),
      ...(filters.occurredFrom || filters.occurredTo
        ? {
            occurredAt: {
              ...(filters.occurredFrom ? { gte: filters.occurredFrom } : {}),
              ...(filters.occurredTo ? { lte: filters.occurredTo } : {}),
            },
          }
        : {}),
    };
    const [total, events] = await this.client.$transaction([
      this.client.auditEvent.count({ where }),
      this.client.auditEvent.findMany({
        where,
        orderBy: [{ occurredAt: 'desc' }, { id: 'desc' }],
        skip: (page - 1) * pageSize,
        take: pageSize,
        select: auditSelect,
      }),
    ]);
    return { items: events.map(auditView), page, pageSize, total };
  }

  async listSecurity(
    organizationId: string,
    filters: SecurityEventFilters,
    page: number,
    pageSize: number,
  ): Promise<Page<SecurityEventView>> {
    const where: Prisma.SecurityEventWhereInput = {
      organizationId,
      ...(filters.eventType ? { eventType: filters.eventType } : {}),
      ...(filters.category ? { category: filters.category } : {}),
      ...(filters.outcome ? { outcome: filters.outcome } : {}),
      ...(filters.risk ? { risk: filters.risk } : {}),
      ...(filters.occurredFrom || filters.occurredTo
        ? {
            occurredAt: {
              ...(filters.occurredFrom ? { gte: filters.occurredFrom } : {}),
              ...(filters.occurredTo ? { lte: filters.occurredTo } : {}),
            },
          }
        : {}),
    };
    const [total, events] = await this.client.$transaction([
      this.client.securityEvent.count({ where }),
      this.client.securityEvent.findMany({
        where,
        orderBy: [{ occurredAt: 'desc' }, { id: 'desc' }],
        skip: (page - 1) * pageSize,
        take: pageSize,
        select: securitySelect,
      }),
    ]);
    return { items: events.map(securityView), page, pageSize, total };
  }

  async findAuditById(organizationId: string, id: string): Promise<AuditEventView | null> {
    const event = await this.client.auditEvent.findFirst({
      where: { id, organizationId },
      select: auditSelect,
    });
    return event ? auditView(event) : null;
  }

  async findSecurityById(organizationId: string, id: string): Promise<SecurityEventView | null> {
    const event = await this.client.securityEvent.findFirst({
      where: { id, organizationId },
      select: securitySelect,
    });
    return event ? securityView(event) : null;
  }
}

@Injectable()
export class PrismaAuditEventRepository
  implements AuditEventAppendPort, AuditEventReadRepositoryPort
{
  constructor(
    @Inject(PrismaEventHistoryRepository)
    private readonly repository: PrismaEventHistoryRepository,
  ) {}

  append(input: AuditEventAppendInput, transaction?: DatabaseTransaction): Promise<AuditEventView> {
    return this.repository.appendAudit(input, transaction);
  }

  list(
    organizationId: string,
    filters: AuditEventFilters,
    page: number,
    pageSize: number,
  ): Promise<Page<AuditEventView>> {
    return this.repository.listAudit(organizationId, filters, page, pageSize);
  }

  findById(organizationId: string, id: string): Promise<AuditEventView | null> {
    return this.repository.findAuditById(organizationId, id);
  }
}

@Injectable()
export class PrismaSecurityEventRepository
  implements SecurityEventAppendPort, SecurityEventReadRepositoryPort
{
  constructor(
    @Inject(PrismaEventHistoryRepository)
    private readonly repository: PrismaEventHistoryRepository,
  ) {}

  append(
    input: SecurityEventAppendInput,
    transaction?: DatabaseTransaction,
  ): Promise<SecurityEventView> {
    return this.repository.appendSecurity(input, transaction);
  }

  list(
    organizationId: string,
    filters: SecurityEventFilters,
    page: number,
    pageSize: number,
  ): Promise<Page<SecurityEventView>> {
    return this.repository.listSecurity(organizationId, filters, page, pageSize);
  }

  findById(organizationId: string, id: string): Promise<SecurityEventView | null> {
    return this.repository.findSecurityById(organizationId, id);
  }
}
