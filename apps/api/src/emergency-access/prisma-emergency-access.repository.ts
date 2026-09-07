import { Inject, Injectable } from '@nestjs/common';
import {
  DATABASE_CLIENT,
  type DatabaseClient,
  type DatabaseTransaction,
  type Prisma,
  runInTransaction,
} from '@dar-tech/database';
import { REQUEST_CONTEXT_STORE, type RequestContextStore } from '@dar-tech/observability';
import { persistOutboxEvent } from '@dar-tech/outbox';
import {
  AUDIT_ACTION_KEYS,
  AUDIT_EVENT_APPEND_PORT,
  SECURITY_EVENT_APPEND_PORT,
  SECURITY_EVENT_TYPES,
  type AuditActionKey,
  type AuditEventAppendPort,
  type SecurityEventAppendPort,
  type SecurityEventType,
} from '../event-history/event-history.contracts.js';
import type {
  EmergencyAccessCreateData,
  EmergencyAccessGrantView,
  EmergencyAccessPage,
  EmergencyAccessRepositoryPort,
  EmergencyAccessStoredStatus,
  EmergencyAccessSubject,
} from './emergency-access.contracts.js';
import { EMERGENCY_ACCESS_EVENTS } from './emergency-access.events.js';

const include = {
  approval: { select: { status: true, executionState: true } },
  bindings: {
    orderBy: [
      { permissionKey: 'asc' as const },
      { scopeType: 'asc' as const },
      { resourceType: 'asc' as const },
      { resourceId: 'asc' as const },
    ],
  },
} satisfies Prisma.EmergencyAccessGrantInclude;

type RawGrant = Prisma.EmergencyAccessGrantGetPayload<{ include: typeof include }>;

function snapshot(value: Prisma.JsonValue): Readonly<Record<string, string>> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  return Object.fromEntries(Object.entries(value).filter((entry): entry is [string, string] => typeof entry[1] === 'string' && ['displayName', 'employeeCode'].includes(entry[0])));
}

function effectiveStatus(grant: RawGrant, at: Date): EmergencyAccessStoredStatus {
  return grant.status === 'ACTIVE' && at >= grant.expiresAt ? 'EXPIRED' : grant.status;
}

function view(grant: RawGrant, at: Date): EmergencyAccessGrantView {
  const status = effectiveStatus(grant, at);
  const activatable = ['PENDING_APPROVAL', 'ACTIVATION_ELIGIBLE'].includes(grant.status) && at >= grant.requestedStartsAt && at < grant.expiresAt;
  const revocable = ['PENDING_APPROVAL', 'ACTIVATION_ELIGIBLE', 'ACTIVE'].includes(grant.status) && at < grant.expiresAt;
  return {
    id: grant.id,
    organizationId: grant.organizationId,
    requesterEmployeeId: grant.requesterEmployeeId,
    recipientEmployeeId: grant.recipientEmployeeId,
    requesterSnapshot: snapshot(grant.requesterSnapshot),
    recipientSnapshot: snapshot(grant.recipientSnapshot),
    reason: grant.safeReason,
    requestedRisk: grant.requestedRisk,
    effectiveRisk: grant.effectiveRisk,
    startsAt: grant.requestedStartsAt,
    expiresAt: grant.expiresAt,
    activatedAt: grant.activatedAt,
    storedStatus: grant.status,
    status,
    approvalReference: grant.approvalReference,
    approvalStatus: grant.approval?.status ?? null,
    approvalExecutionState: grant.approval?.executionState ?? null,
    policyKey: grant.policyKey,
    policyVersion: grant.policyVersion,
    policyFingerprint: grant.policyFingerprint,
    contextFingerprint: grant.contextFingerprint,
    stepUpAssuranceLevel: grant.stepUpAssuranceLevel,
    stepUpVerifiedAt: grant.stepUpVerifiedAt,
    denialCode: grant.denialCode,
    deniedAt: grant.deniedAt,
    revokedAt: grant.revokedAt,
    revokedByEmployeeId: grant.revokedByEmployeeId,
    bindings: grant.bindings.map((binding) => ({
      id: binding.id,
      permissionKey: binding.permissionKey,
      riskClassification: binding.permissionRiskSnapshot,
      scopeType: binding.scopeType as Exclude<typeof binding.scopeType, 'SELF'>,
      resourceType: binding.resourceType as EmergencyAccessGrantView['bindings'][number]['resourceType'],
      resourceId: binding.resourceId,
    })),
    history: [],
    canActivate: activatable,
    canRevoke: revocable,
    createdAt: grant.createdAt,
    updatedAt: grant.updatedAt,
    version: grant.version,
  };
}

@Injectable()
export class PrismaEmergencyAccessRepository implements EmergencyAccessRepositoryPort {
  constructor(
    @Inject(DATABASE_CLIENT) private readonly client: DatabaseClient,
    @Inject(AUDIT_EVENT_APPEND_PORT) private readonly audit: AuditEventAppendPort,
    @Inject(SECURITY_EVENT_APPEND_PORT) private readonly security: SecurityEventAppendPort,
    @Inject(REQUEST_CONTEXT_STORE) private readonly context: RequestContextStore,
  ) {}

  transaction<T>(work: (transaction: DatabaseTransaction) => Promise<T>): Promise<T> {
    return runInTransaction(this.client, work);
  }

  async lockIdempotency(transaction: DatabaseTransaction, digest: string): Promise<void> {
    await transaction.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${digest}, 0))`;
  }

  async findSubject(organizationId: string, employeeId: string, suppliedTransaction?: DatabaseTransaction): Promise<EmergencyAccessSubject | null> {
    const transaction = suppliedTransaction ?? this.client;
    if (suppliedTransaction) {
      await suppliedTransaction.$queryRaw`SELECT id FROM employees WHERE organization_id = ${organizationId}::uuid AND id = ${employeeId}::uuid FOR UPDATE`;
    }
    const employee = await transaction.employee.findFirst({
      where: { organizationId, id: employeeId },
      select: {
        id: true,
        organizationId: true,
        displayName: true,
        employeeCode: true,
        lifecycleStatus: true,
        userAccount: { select: { id: true, authenticationEligible: true, disabledAt: true } },
      },
    });
    if (!employee?.userAccount) return null;
    return {
      organizationId: employee.organizationId,
      employeeId: employee.id,
      userAccountId: employee.userAccount.id,
      displayName: employee.displayName,
      employeeCode: employee.employeeCode,
      active: employee.lifecycleStatus === 'ACTIVE' && employee.userAccount.authenticationEligible && employee.userAccount.disabledAt === null,
    };
  }

  async findByIdempotency(organizationId: string, digest: string, at: Date, transaction: DatabaseTransaction = this.client): Promise<EmergencyAccessGrantView | null> {
    const grant = await transaction.emergencyAccessGrant.findUnique({ where: { organizationId_idempotencyDigest: { organizationId, idempotencyDigest: digest } }, include });
    return grant ? view(grant, at) : null;
  }

  async create(input: EmergencyAccessCreateData, transaction: DatabaseTransaction): Promise<EmergencyAccessGrantView> {
    const requester = await this.findSubject(
      input.actor.organizationId,
      input.actor.employeeId,
      transaction,
    );
    if (!requester?.active) throw new Error('Emergency access requester is not current');
    const recipient = await this.findSubject(
      input.actor.organizationId,
      input.recipient.employeeId,
      transaction,
    );
    if (!recipient?.active) throw new Error('Emergency access recipient is not current');
    const grant = await transaction.emergencyAccessGrant.create({
      data: {
        id: input.id,
        organizationId: input.actor.organizationId,
        requesterEmployeeId: input.actor.employeeId,
        recipientEmployeeId: input.recipient.employeeId,
        requesterSnapshot: { displayName: input.requester.displayName, employeeCode: input.requester.employeeCode },
        recipientSnapshot: { displayName: input.recipient.displayName, employeeCode: input.recipient.employeeCode },
        safeReason: input.reason,
        requestedRisk: input.requestedRisk,
        effectiveRisk: input.effectiveRisk,
        requestedStartsAt: input.startsAt,
        requestedExpiresAt: input.expiresAt,
        expiresAt: input.expiresAt,
        status: input.approvalReference ? 'PENDING_APPROVAL' : 'ACTIVATION_ELIGIBLE',
        approvalReference: input.approvalReference,
        policyKey: input.policy.policyKey,
        policyVersion: input.policy.policyVersion,
        policyFingerprint: input.policy.fingerprint,
        contextFingerprint: input.contextFingerprint,
        stepUpAssuranceLevel: input.policy.stepUpRequirement!.assuranceLevel,
        stepUpVerifiedAt: input.stepUpVerifiedAt,
        idempotencyDigest: input.idempotencyDigest,
        requestFingerprint: input.requestFingerprint,
        bindings: {
          create: input.bindings.map((binding) => ({
            permissionKey: binding.permissionKey,
            permissionRiskSnapshot: binding.riskClassification,
            scopeType: binding.scopeType,
            scopeBindingType: binding.scopeType === 'ORGANIZATION' ? null : binding.resourceType,
            scopeBindingId: binding.scopeType === 'ORGANIZATION' ? null : binding.resourceId,
            resourceType: binding.resourceType,
            resourceId: binding.resourceId,
          })),
        },
      },
      include,
    });
    await this.recordLifecycle(transaction, 'requested', grant, input.actor.employeeId, input.actor.userAccountId, input.actor.sessionId, input.correlationId, input.at);
    return view(grant, input.at);
  }

  async activate(input: Parameters<EmergencyAccessRepositoryPort['activate']>[0], transaction: DatabaseTransaction): Promise<{ readonly outcome: 'activated' | 'idempotent'; readonly grant: EmergencyAccessGrantView }> {
    await this.lockGrant(transaction, input.organizationId, input.id);
    const current = await transaction.emergencyAccessGrant.findFirst({ where: { organizationId: input.organizationId, id: input.id }, include });
    if (!current) throw new Error('Emergency access activation is unavailable');
    if (current.status === 'ACTIVE') return { outcome: 'idempotent', grant: view(current, input.at) };
    if (!['PENDING_APPROVAL', 'ACTIVATION_ELIGIBLE'].includes(current.status) || current.approvalReference !== input.approvalReference || input.at < current.requestedStartsAt || input.at >= current.expiresAt) throw new Error('Emergency access activation is unavailable');
    const grant = await transaction.emergencyAccessGrant.update({ where: { id: current.id }, data: { status: 'ACTIVE', activatedAt: input.at, stepUpVerifiedAt: input.stepUpVerifiedAt, version: { increment: 1 } }, include });
    await this.recordLifecycle(transaction, 'activated', grant, input.actorEmployeeId, null, null, input.correlationId, input.at);
    return { outcome: 'activated', grant: view(grant, input.at) };
  }

  async recordDenied(input: { readonly organizationId: string; readonly id: string; readonly actor: Parameters<EmergencyAccessRepositoryPort['recordDenied']>[0]['actor']; readonly denialCode: string; readonly correlationId: string; readonly terminal: boolean; readonly at: Date }, transaction: DatabaseTransaction): Promise<void> {
    await this.lockGrant(transaction, input.organizationId, input.id);
    let grant = await transaction.emergencyAccessGrant.findFirst({ where: { organizationId: input.organizationId, id: input.id }, include });
    if (!grant || ['DENIED', 'REVOKED', 'EXPIRED'].includes(grant.status)) return;
    if (input.terminal && grant.status !== 'ACTIVE') {
      grant = await transaction.emergencyAccessGrant.update({ where: { id: grant.id }, data: { status: 'DENIED', denialCode: input.denialCode, deniedAt: input.at, version: { increment: 1 } }, include });
    }
    await this.recordLifecycle(transaction, 'denied', grant, input.actor.employeeId, input.actor.userAccountId, input.actor.sessionId, input.correlationId, input.at, input.denialCode);
  }

  async list(input: { readonly organizationId: string; readonly page: number; readonly pageSize: number; readonly status?: EmergencyAccessStoredStatus; readonly recipientEmployeeId?: string; readonly risk?: EmergencyAccessGrantView['effectiveRisk']; readonly at: Date }): Promise<EmergencyAccessPage> {
    const where: Prisma.EmergencyAccessGrantWhereInput = {
      organizationId: input.organizationId,
      ...(input.recipientEmployeeId ? { recipientEmployeeId: input.recipientEmployeeId } : {}),
      ...(input.risk ? { effectiveRisk: input.risk } : {}),
      ...(input.status ? input.status === 'EXPIRED' ? { OR: [{ status: 'EXPIRED' }, { status: 'ACTIVE', expiresAt: { lte: input.at } }] } : { status: input.status } : {}),
    };
    const [total, grants] = await this.client.$transaction([
      this.client.emergencyAccessGrant.count({ where }),
      this.client.emergencyAccessGrant.findMany({ where, orderBy: [{ createdAt: 'desc' }, { id: 'desc' }], skip: (input.page - 1) * input.pageSize, take: input.pageSize, include }),
    ]);
    return { items: grants.map((grant) => view(grant, input.at)), page: input.page, pageSize: input.pageSize, total };
  }

  async findById(organizationId: string, id: string, at: Date, transaction: DatabaseTransaction = this.client): Promise<EmergencyAccessGrantView | null> {
    const grant = await transaction.emergencyAccessGrant.findFirst({ where: { organizationId, id }, include });
    if (!grant) return null;
    const events = await transaction.securityEvent.findMany({
      where: {
        organizationId,
        eventType: { in: Object.values(SECURITY_EVENT_TYPES).filter((eventType) => eventType.startsWith('EmergencyAccess')) },
        safeContext: { path: ['grantId'], equals: id },
      },
      orderBy: [{ occurredAt: 'desc' }, { id: 'desc' }],
      take: 100,
      select: { eventType: true, outcome: true, risk: true, safeContext: true, occurredAt: true },
    });
    return {
      ...view(grant, at),
      history: events.map((event) => {
        const context = event.safeContext && typeof event.safeContext === 'object' && !Array.isArray(event.safeContext)
          ? event.safeContext as Record<string, unknown>
          : {};
        return {
          eventType: event.eventType,
          outcome: event.outcome,
          risk: event.risk,
          action: typeof context.action === 'string' ? context.action : null,
          resourceType: typeof context.resourceType === 'string' ? context.resourceType : null,
          resourceId: typeof context.resourceId === 'string' ? context.resourceId : null,
          occurredAt: event.occurredAt,
        };
      }),
    };
  }

  async revoke(input: { readonly organizationId: string; readonly id: string; readonly actorEmployeeId: string; readonly correlationId: string; readonly at: Date }, transaction: DatabaseTransaction): Promise<{ readonly outcome: 'revoked' | 'idempotent' | 'not_found'; readonly grant: EmergencyAccessGrantView | null }> {
    await this.lockGrant(transaction, input.organizationId, input.id);
    const current = await transaction.emergencyAccessGrant.findFirst({ where: { organizationId: input.organizationId, id: input.id }, include });
    if (!current) return { outcome: 'not_found', grant: null };
    if (['DENIED', 'REVOKED', 'EXPIRED'].includes(current.status)) return { outcome: 'idempotent', grant: view(current, input.at) };
    if (current.status === 'ACTIVE' && current.expiresAt <= input.at) {
      const expired = await transaction.emergencyAccessGrant.update({ where: { id: current.id }, data: { status: 'EXPIRED', version: { increment: 1 } }, include });
      await this.recordLifecycle(transaction, 'expired', expired, null, null, null, input.correlationId, input.at);
      return { outcome: 'idempotent', grant: view(expired, input.at) };
    }
    const revoked = await transaction.emergencyAccessGrant.update({ where: { id: current.id }, data: { status: 'REVOKED', revokedAt: input.at, revokedByEmployeeId: input.actorEmployeeId, version: { increment: 1 } }, include });
    await this.recordLifecycle(transaction, 'revoked', revoked, input.actorEmployeeId, null, null, input.correlationId, input.at);
    return { outcome: 'revoked', grant: view(revoked, input.at) };
  }

  async revokeAllForRecipient(input: { readonly organizationId: string; readonly recipientEmployeeId: string; readonly actorEmployeeId: string; readonly correlationId: string; readonly at: Date }, transaction: DatabaseTransaction): Promise<number> {
    const references = await transaction.emergencyAccessGrant.findMany({
      where: {
        organizationId: input.organizationId,
        recipientEmployeeId: input.recipientEmployeeId,
        status: { in: ['PENDING_APPROVAL', 'ACTIVATION_ELIGIBLE', 'ACTIVE'] },
      },
      orderBy: { id: 'asc' },
      select: { id: true },
    });
    let ended = 0;
    for (const reference of references) {
      await this.lockGrant(transaction, input.organizationId, reference.id);
      const current = await transaction.emergencyAccessGrant.findFirst({
        where: {
          id: reference.id,
          organizationId: input.organizationId,
          recipientEmployeeId: input.recipientEmployeeId,
          status: { in: ['PENDING_APPROVAL', 'ACTIVATION_ELIGIBLE', 'ACTIVE'] },
        },
        include,
      });
      if (!current) continue;
      if (current.status === 'ACTIVE' && current.expiresAt <= input.at) {
        const expired = await transaction.emergencyAccessGrant.update({ where: { id: current.id }, data: { status: 'EXPIRED', version: { increment: 1 } }, include });
        await this.recordLifecycle(transaction, 'expired', expired, null, null, null, input.correlationId, input.at);
      } else {
        const revoked = await transaction.emergencyAccessGrant.update({
          where: { id: current.id },
          data: { status: 'REVOKED', revokedAt: input.at, revokedByEmployeeId: input.actorEmployeeId, version: { increment: 1 } },
          include,
        });
        await this.recordLifecycle(transaction, 'revoked', revoked, input.actorEmployeeId, null, null, input.correlationId, input.at);
      }
      ended += 1;
    }
    return ended;
  }

  async recordMaterialUse(input: { readonly organizationId: string; readonly grantId: string; readonly actor: Parameters<EmergencyAccessRepositoryPort['recordMaterialUse']>[0]['actor']; readonly action: string; readonly resource: Parameters<EmergencyAccessRepositoryPort['recordMaterialUse']>[0]['resource']; readonly correlationId: string; readonly at: Date }, transaction: DatabaseTransaction): Promise<boolean> {
    const grant = await transaction.emergencyAccessGrant.findFirst({
      where: { id: input.grantId, organizationId: input.organizationId, recipientEmployeeId: input.actor.employeeId, status: 'ACTIVE', requestedStartsAt: { lte: input.at }, expiresAt: { gt: input.at }, bindings: { some: { permissionKey: input.action } } },
      include,
    });
    if (!grant) return false;
    await this.recordLifecycle(transaction, 'used', grant, input.actor.employeeId, input.actor.userAccountId, input.actor.sessionId, input.correlationId, input.at, undefined, input.action, input.resource);
    return true;
  }

  private async lockGrant(transaction: DatabaseTransaction, organizationId: string, id: string): Promise<void> {
    await transaction.$queryRaw`SELECT id FROM emergency_access_grants WHERE id = ${id}::uuid AND organization_id = ${organizationId}::uuid FOR UPDATE`;
  }

  private history(correlationId: string): { readonly requestId?: string; readonly correlationId: string } {
    const current = this.context.get();
    return { ...(current?.requestId ? { requestId: current.requestId } : {}), correlationId: current?.correlationId ?? correlationId };
  }

  private async recordLifecycle(
    transaction: DatabaseTransaction,
    kind: keyof typeof EMERGENCY_ACCESS_EVENTS,
    grant: RawGrant,
    actorEmployeeId: string | null,
    actorAccountId: string | null,
    sessionReference: string | null,
    correlationId: string,
    at: Date,
    denialCode?: string,
    materialAction?: string,
    materialResource?: { readonly type: string; readonly id?: string },
  ): Promise<void> {
    const auditKeys: Record<keyof typeof EMERGENCY_ACCESS_EVENTS, AuditActionKey> = {
      requested: AUDIT_ACTION_KEYS.emergencyAccessRequested,
      activated: AUDIT_ACTION_KEYS.emergencyAccessActivated,
      denied: AUDIT_ACTION_KEYS.emergencyAccessDenied,
      used: AUDIT_ACTION_KEYS.emergencyAccessUsed,
      revoked: AUDIT_ACTION_KEYS.emergencyAccessRevoked,
      expired: AUDIT_ACTION_KEYS.emergencyAccessExpired,
    };
    const securityTypes: Record<keyof typeof EMERGENCY_ACCESS_EVENTS, SecurityEventType> = {
      requested: SECURITY_EVENT_TYPES.emergencyAccessRequested,
      activated: SECURITY_EVENT_TYPES.emergencyAccessActivated,
      denied: SECURITY_EVENT_TYPES.emergencyAccessDenied,
      used: SECURITY_EVENT_TYPES.emergencyAccessUsed,
      revoked: SECURITY_EVENT_TYPES.emergencyAccessRevoked,
      expired: SECURITY_EVENT_TYPES.emergencyAccessExpired,
    };
    const actorSnapshot = actorEmployeeId ? { type: 'employee' as const, ...(actorEmployeeId === grant.requesterEmployeeId ? snapshot(grant.requesterSnapshot) : actorEmployeeId === grant.recipientEmployeeId ? snapshot(grant.recipientSnapshot) : {}) } : { type: 'system' as const };
    const history = this.history(correlationId);
    await this.audit.append({
      organizationId: grant.organizationId,
      actionKey: auditKeys[kind],
      ...(actorEmployeeId ? { actorEmployeeId } : {}),
      actorSnapshot,
      targetType: 'emergency-access-grant',
      targetId: grant.id,
      targetSnapshot: snapshot(grant.recipientSnapshot),
      ...(kind === 'requested' ? { safeReason: grant.safeReason } : {}),
      changeDelta: { changedFields: kind === 'used' ? ['action'] : kind === 'denied' ? ['denialCode', 'status'] : kind === 'activated' ? ['activatedAt', 'status', 'stepUp'] : ['status'] },
      ...(grant.approvalReference ? { approvalReference: grant.approvalReference } : {}),
      ...(sessionReference ? { sessionReference } : {}),
      ...history,
      occurredAt: at,
    }, transaction);
    await this.security.append({
      organizationId: grant.organizationId,
      eventType: securityTypes[kind],
      category: `emergency_access_${kind}`,
      risk: grant.effectiveRisk,
      outcome: kind === 'denied' ? 'DENIED' : 'SUCCEEDED',
      ...(actorEmployeeId ? { actorEmployeeId } : {}),
      ...(actorAccountId ? { actorAccountId } : {}),
      ...(sessionReference ? { sessionReference } : {}),
      actorSnapshot,
      safeContext: {
        grantId: grant.id,
        recipientEmployeeId: grant.recipientEmployeeId,
        requestedRisk: grant.requestedRisk,
        effectiveRisk: grant.effectiveRisk,
        permissionCount: grant.bindings.length,
        ...(denialCode ? { denialReason: denialCode } : {}),
        ...(materialAction ? { action: materialAction } : {}),
        ...(materialResource ? { resourceType: materialResource.type, ...(materialResource.id ? { resourceId: materialResource.id } : {}) } : {}),
      },
      ...history,
      occurredAt: at,
    }, transaction);
    await persistOutboxEvent(transaction, {
      eventType: EMERGENCY_ACCESS_EVENTS[kind].eventType,
      eventVersion: 1,
      organizationId: grant.organizationId,
      correlationId: history.correlationId,
      ...(history.requestId ? { causationId: history.requestId } : {}),
      occurredAt: at,
      payload: {
        emergencyAccessGrantId: grant.id,
        requesterEmployeeId: grant.requesterEmployeeId,
        recipientEmployeeId: grant.recipientEmployeeId,
        requestedRisk: grant.requestedRisk,
        effectiveRisk: grant.effectiveRisk,
        permissionCount: grant.bindings.length,
        startsAt: grant.requestedStartsAt.toISOString(),
        expiresAt: grant.expiresAt.toISOString(),
        ...(grant.approvalReference ? { approvalReference: grant.approvalReference } : {}),
        ...(denialCode ? { denialCode } : {}),
        ...(materialAction ? { action: materialAction } : {}),
        ...(materialResource ? { resourceType: materialResource.type, ...(materialResource.id ? { resourceId: materialResource.id } : {}) } : {}),
      },
    });
  }
}
