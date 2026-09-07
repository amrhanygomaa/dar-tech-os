import { Inject, Injectable } from "@nestjs/common";
import {
  DATABASE_CLIENT,
  type Prisma,
  runInTransaction,
  type DatabaseClient,
  type DatabaseTransaction,
} from "@dar-tech/database";
import { persistOutboxEvent } from "@dar-tech/outbox";
import {
  REQUEST_CONTEXT_STORE,
  type RequestContextStore,
} from "@dar-tech/observability";
import {
  AUDIT_ACTION_KEYS,
  AUDIT_EVENT_APPEND_PORT,
  type AuditEventAppendPort,
} from "../event-history/event-history.contracts.js";
import { TEMPORARY_ACCESS_EVENTS } from "./temporary-access.events.js";
import type {
  TemporaryAccessCreateData,
  TemporaryAccessRecipient,
  TemporaryAccessPage,
  TemporaryAccessEffectiveStatus,
  TemporaryAccessGrantView,
  TemporaryAccessRepositoryPort,
  TemporaryAccessStoredStatus,
} from "./temporary-access.contracts.js";

const include = {
  bindings: {
    orderBy: [
      { permissionKey: "asc" as const },
      { scopeType: "asc" as const },
      { resourceType: "asc" as const },
      { resourceId: "asc" as const },
    ],
  },
} satisfies Prisma.TemporaryAccessGrantInclude;
type RawGrant = Prisma.TemporaryAccessGrantGetPayload<{
  include: typeof include;
}>;

function snapshot(value: Prisma.JsonValue): Readonly<Record<string, string>> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return Object.fromEntries(
    Object.entries(value).filter(
      (entry): entry is [string, string] =>
        typeof entry[1] === "string" &&
        ["displayName", "employeeCode"].includes(entry[0]),
    ),
  );
}

function effectiveStatus(
  status: TemporaryAccessStoredStatus,
  startsAt: Date,
  expiresAt: Date,
  at: Date,
): TemporaryAccessEffectiveStatus {
  if (
    status === "PENDING_APPROVAL" ||
    status === "REVOKED" ||
    status === "EXPIRED"
  )
    return status;
  if (at >= expiresAt) return "EXPIRED";
  if (at < startsAt) return "SCHEDULED";
  return "ACTIVE";
}

function view(grant: RawGrant, at: Date): TemporaryAccessGrantView {
  const status = effectiveStatus(
    grant.status,
    grant.startsAt,
    grant.expiresAt,
    at,
  );
  return {
    id: grant.id,
    organizationId: grant.organizationId,
    issuerEmployeeId: grant.issuerEmployeeId,
    recipientEmployeeId: grant.recipientEmployeeId,
    issuerSnapshot: snapshot(grant.issuerSnapshot),
    recipientSnapshot: snapshot(grant.recipientSnapshot),
    reason: grant.safeReason,
    startsAt: grant.startsAt,
    expiresAt: grant.expiresAt,
    storedStatus: grant.status,
    status,
    approvalReference: grant.approvalReference,
    requestedAt: grant.requestedAt,
    grantedAt: grant.grantedAt,
    revokedAt: grant.revokedAt,
    revokedByEmployeeId: grant.revokedByEmployeeId,
    bindings: grant.bindings.map((binding) => ({
      id: binding.id,
      permissionKey: binding.permissionKey,
      riskClassification: binding.permissionRiskSnapshot,
      scopeType: binding.scopeType as Exclude<typeof binding.scopeType, "SELF">,
      resourceType:
        binding.resourceType as TemporaryAccessGrantView["bindings"][number]["resourceType"],
      resourceId: binding.resourceId,
    })),
    canRevoke: grant.status === "GRANTED" && at < grant.expiresAt,
    createdAt: grant.createdAt,
    updatedAt: grant.updatedAt,
    version: grant.version,
  };
}

@Injectable()
export class PrismaTemporaryAccessRepository implements TemporaryAccessRepositoryPort {
  constructor(
    @Inject(DATABASE_CLIENT) private readonly client: DatabaseClient,
    @Inject(AUDIT_EVENT_APPEND_PORT)
    private readonly audit: AuditEventAppendPort,
    @Inject(REQUEST_CONTEXT_STORE)
    private readonly context: RequestContextStore,
  ) {}

  transaction<T>(
    work: (transaction: DatabaseTransaction) => Promise<T>,
  ): Promise<T> {
    return runInTransaction(this.client, work);
  }

  async lockIdempotency(
    transaction: DatabaseTransaction,
    digest: string,
  ): Promise<void> {
    await transaction.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${digest}, 0))`;
  }

  async findRecipient(
    organizationId: string,
    employeeId: string,
    suppliedTransaction?: DatabaseTransaction,
  ): Promise<
    TemporaryAccessRecipient | null
  > {
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
        userAccount: {
          select: { id: true, authenticationEligible: true, disabledAt: true },
        },
      },
    });
    if (!employee?.userAccount) return null;
    return {
      organizationId: employee.organizationId,
      employeeId: employee.id,
      userAccountId: employee.userAccount.id,
      displayName: employee.displayName,
      employeeCode: employee.employeeCode,
      active:
        employee.lifecycleStatus === "ACTIVE" &&
        employee.userAccount.authenticationEligible &&
        employee.userAccount.disabledAt === null,
    };
  }

  async findByIdempotency(
    organizationId: string,
    digest: string,
    at: Date,
    transaction: DatabaseTransaction = this.client,
  ): Promise<TemporaryAccessGrantView | null> {
    const grant = await transaction.temporaryAccessGrant.findUnique({
      where: {
        organizationId_idempotencyDigest: {
          organizationId,
          idempotencyDigest: digest,
        },
      },
      include,
    });
    return grant ? view(grant, at) : null;
  }

  async create(
    input: TemporaryAccessCreateData,
    transaction: DatabaseTransaction,
  ): Promise<TemporaryAccessGrantView> {
    const issuer = await this.findRecipient(
      input.actor.organizationId,
      input.actor.employeeId,
      transaction,
    );
    if (!issuer?.active)
      throw new Error("Temporary access issuer is not current");
    const recipient = await this.findRecipient(
      input.actor.organizationId,
      input.recipient.employeeId,
      transaction,
    );
    if (!recipient?.active)
      throw new Error("Temporary access recipient is not current");
    const grant = await transaction.temporaryAccessGrant.create({
      data: {
        organizationId: input.actor.organizationId,
        issuerEmployeeId: input.actor.employeeId,
        recipientEmployeeId: input.recipient.employeeId,
        issuerSnapshot: {
          displayName: issuer.displayName,
          employeeCode: issuer.employeeCode,
        },
        recipientSnapshot: {
          displayName: input.recipient.displayName,
          employeeCode: input.recipient.employeeCode,
        },
        safeReason: input.reason,
        startsAt: input.startsAt,
        expiresAt: input.expiresAt,
        status: input.granted ? "GRANTED" : "PENDING_APPROVAL",
        approvalReference: input.approvalReference,
        idempotencyDigest: input.idempotencyDigest,
        requestFingerprint: input.requestFingerprint,
        contextFingerprint: input.contextFingerprint,
        requestedAt: input.at,
        grantedAt: input.granted ? input.at : null,
        bindings: {
          create: input.bindings.map((binding) => ({
            permissionKey: binding.permissionKey,
            permissionRiskSnapshot: binding.riskClassification,
            scopeType: binding.scopeType,
            scopeBindingType:
              binding.scopeType === "ORGANIZATION"
                ? null
                : binding.resourceType,
            scopeBindingId:
              binding.scopeType === "ORGANIZATION" ? null : binding.resourceId,
            resourceType: binding.resourceType,
            resourceId: binding.resourceId,
          })),
        },
      },
      include,
    });
    await this.recordRequested(
      transaction,
      grant,
      input.correlationId,
      input.at,
    );
    if (input.granted)
      await this.recordGranted(
        transaction,
        grant,
        input.correlationId,
        input.at,
      );
    return view(grant, input.at);
  }

  async activate(
    input: {
      readonly organizationId: string;
      readonly grantId: string;
      readonly actorEmployeeId: string;
      readonly approvalReference: string;
      readonly correlationId: string;
      readonly at: Date;
    },
    transaction: DatabaseTransaction,
  ): Promise<TemporaryAccessGrantView> {
    await transaction.$queryRaw`SELECT id FROM temporary_access_grants WHERE id = ${input.grantId}::uuid AND organization_id = ${input.organizationId}::uuid FOR UPDATE`;
    const current = await transaction.temporaryAccessGrant.findFirst({
      where: { id: input.grantId, organizationId: input.organizationId },
      include,
    });
    if (
      !current ||
      current.status !== "PENDING_APPROVAL" ||
      current.approvalReference !== input.approvalReference ||
      current.expiresAt <= input.at
    )
      throw new Error("Temporary access activation is unavailable");
    const grant = await transaction.temporaryAccessGrant.update({
      where: { id: current.id },
      data: {
        status: "GRANTED",
        grantedAt: input.at,
        version: { increment: 1 },
      },
      include,
    });
    await this.recordGranted(transaction, grant, input.correlationId, input.at);
    return view(grant, input.at);
  }

  async list(input: {
    readonly organizationId: string;
    readonly page: number;
    readonly pageSize: number;
    readonly status?: TemporaryAccessEffectiveStatus;
    readonly recipientEmployeeId?: string;
    readonly at: Date;
  }): Promise<TemporaryAccessPage> {
    const where: Prisma.TemporaryAccessGrantWhereInput = {
      organizationId: input.organizationId,
      ...(input.recipientEmployeeId
        ? { recipientEmployeeId: input.recipientEmployeeId }
        : {}),
      ...this.statusWhere(input.status, input.at),
    };
    const [total, grants] = await this.client.$transaction([
      this.client.temporaryAccessGrant.count({ where }),
      this.client.temporaryAccessGrant.findMany({
        where,
        orderBy: [{ createdAt: "desc" }, { id: "desc" }],
        skip: (input.page - 1) * input.pageSize,
        take: input.pageSize,
        include,
      }),
    ]);
    return {
      items: grants.map((grant) => view(grant, input.at)),
      page: input.page,
      pageSize: input.pageSize,
      total,
    };
  }

  async findById(
    organizationId: string,
    id: string,
    at: Date,
    transaction: DatabaseTransaction = this.client,
  ): Promise<TemporaryAccessGrantView | null> {
    const grant = await transaction.temporaryAccessGrant.findFirst({
      where: { organizationId, id },
      include,
    });
    return grant ? view(grant, at) : null;
  }

  async revoke(
    input: {
      readonly organizationId: string;
      readonly id: string;
      readonly actorEmployeeId: string;
      readonly correlationId: string;
      readonly at: Date;
    },
    transaction: DatabaseTransaction,
  ): Promise<{
    readonly outcome: "revoked" | "idempotent" | "not_found";
    readonly grant: TemporaryAccessGrantView | null;
  }> {
    await transaction.$queryRaw`SELECT id FROM temporary_access_grants WHERE id = ${input.id}::uuid AND organization_id = ${input.organizationId}::uuid FOR UPDATE`;
    const current = await transaction.temporaryAccessGrant.findFirst({
      where: { organizationId: input.organizationId, id: input.id },
      include,
    });
    if (!current || current.status === "PENDING_APPROVAL")
      return { outcome: "not_found", grant: null };
    if (current.status !== "GRANTED")
      return { outcome: "idempotent", grant: view(current, input.at) };
    if (current.expiresAt <= input.at) {
      const expired = await transaction.temporaryAccessGrant.update({
        where: { id: current.id },
        data: { status: "EXPIRED", version: { increment: 1 } },
        include,
      });
      await this.recordExpired(
        transaction,
        expired,
        input.correlationId,
        input.at,
      );
      return { outcome: "idempotent", grant: view(expired, input.at) };
    }
    const revoked = await transaction.temporaryAccessGrant.update({
      where: { id: current.id },
      data: {
        status: "REVOKED",
        revokedAt: input.at,
        revokedByEmployeeId: input.actorEmployeeId,
        version: { increment: 1 },
      },
      include,
    });
    await this.recordRevoked(
      transaction,
      revoked,
      input.actorEmployeeId,
      input.correlationId,
      input.at,
    );
    return { outcome: "revoked", grant: view(revoked, input.at) };
  }

  async revokeAllForRecipient(
    input: {
      readonly organizationId: string;
      readonly recipientEmployeeId: string;
      readonly actorEmployeeId: string;
      readonly correlationId: string;
      readonly at: Date;
    },
    transaction: DatabaseTransaction,
  ): Promise<number> {
    const references = await transaction.temporaryAccessGrant.findMany({
      where: {
        organizationId: input.organizationId,
        recipientEmployeeId: input.recipientEmployeeId,
        status: { in: ["PENDING_APPROVAL", "GRANTED"] },
      },
      orderBy: { id: "asc" },
      select: { id: true },
    });
    let ended = 0;
    for (const reference of references) {
      await transaction.$queryRaw`SELECT id FROM temporary_access_grants WHERE id = ${reference.id}::uuid AND organization_id = ${input.organizationId}::uuid FOR UPDATE`;
      const current = await transaction.temporaryAccessGrant.findFirst({
        where: {
          id: reference.id,
          organizationId: input.organizationId,
          recipientEmployeeId: input.recipientEmployeeId,
          status: { in: ["PENDING_APPROVAL", "GRANTED"] },
        },
        include,
      });
      if (!current) continue;
      if (current.status === "GRANTED" && current.expiresAt <= input.at) {
        const expired = await transaction.temporaryAccessGrant.update({
          where: { id: current.id },
          data: { status: "EXPIRED", version: { increment: 1 } },
          include,
        });
        await this.recordExpired(transaction, expired, input.correlationId, input.at);
      } else {
        const revoked = await transaction.temporaryAccessGrant.update({
          where: { id: current.id },
          data: {
            status: "REVOKED",
            revokedAt: input.at,
            revokedByEmployeeId: input.actorEmployeeId,
            version: { increment: 1 },
          },
          include,
        });
        await this.recordRevoked(
          transaction,
          revoked,
          input.actorEmployeeId,
          input.correlationId,
          input.at,
        );
      }
      ended += 1;
    }
    return ended;
  }

  private statusWhere(
    status: TemporaryAccessEffectiveStatus | undefined,
    at: Date,
  ): Prisma.TemporaryAccessGrantWhereInput {
    if (!status) return {};
    if (status === "PENDING_APPROVAL" || status === "REVOKED")
      return { status };
    if (status === "EXPIRED")
      return {
        OR: [
          { status: "EXPIRED" },
          { status: "GRANTED", expiresAt: { lte: at } },
        ],
      };
    if (status === "SCHEDULED")
      return { status: "GRANTED", startsAt: { gt: at }, expiresAt: { gt: at } };
    return { status: "GRANTED", startsAt: { lte: at }, expiresAt: { gt: at } };
  }

  private async recordRequested(
    transaction: DatabaseTransaction,
    grant: RawGrant,
    correlationId: string,
    at: Date,
  ): Promise<void> {
    await this.audit.append(
      {
        organizationId: grant.organizationId,
        actionKey: AUDIT_ACTION_KEYS.temporaryAccessRequested,
        actorEmployeeId: grant.issuerEmployeeId,
        actorSnapshot: { type: "employee", ...snapshot(grant.issuerSnapshot) },
        targetType: "temporary-access-grant",
        targetId: grant.id,
        targetSnapshot: snapshot(grant.recipientSnapshot),
        safeReason: grant.safeReason,
        changeDelta: {
          changedFields: ["bindings", "startsAt", "expiresAt", "status"],
        },
        ...(grant.approvalReference
          ? { approvalReference: grant.approvalReference }
          : {}),
        ...this.history(correlationId),
        occurredAt: at,
      },
      transaction,
    );
    await this.outbox(
      transaction,
      TEMPORARY_ACCESS_EVENTS.requested,
      grant,
      correlationId,
      at,
    );
  }

  private async recordGranted(
    transaction: DatabaseTransaction,
    grant: RawGrant,
    correlationId: string,
    at: Date,
  ): Promise<void> {
    await this.audit.append(
      {
        organizationId: grant.organizationId,
        actionKey: AUDIT_ACTION_KEYS.temporaryAccessGranted,
        actorEmployeeId: grant.issuerEmployeeId,
        actorSnapshot: { type: "employee", ...snapshot(grant.issuerSnapshot) },
        targetType: "temporary-access-grant",
        targetId: grant.id,
        targetSnapshot: snapshot(grant.recipientSnapshot),
        safeReason: grant.safeReason,
        changeDelta: { changedFields: ["status", "grantedAt"] },
        ...(grant.approvalReference
          ? { approvalReference: grant.approvalReference }
          : {}),
        ...this.history(correlationId),
        occurredAt: at,
      },
      transaction,
    );
    await this.outbox(
      transaction,
      TEMPORARY_ACCESS_EVENTS.granted,
      grant,
      correlationId,
      at,
    );
  }

  private async recordRevoked(
    transaction: DatabaseTransaction,
    grant: RawGrant,
    actorEmployeeId: string,
    correlationId: string,
    at: Date,
  ): Promise<void> {
    await this.audit.append(
      {
        organizationId: grant.organizationId,
        actionKey: AUDIT_ACTION_KEYS.temporaryAccessRevoked,
        actorEmployeeId,
        actorSnapshot: { type: "employee" },
        targetType: "temporary-access-grant",
        targetId: grant.id,
        targetSnapshot: snapshot(grant.recipientSnapshot),
        changeDelta: {
          changedFields: ["status", "revokedAt", "revokedByEmployeeId"],
        },
        ...(grant.approvalReference
          ? { approvalReference: grant.approvalReference }
          : {}),
        ...this.history(correlationId),
        occurredAt: at,
      },
      transaction,
    );
    await this.outbox(
      transaction,
      TEMPORARY_ACCESS_EVENTS.revoked,
      grant,
      correlationId,
      at,
    );
  }

  private async recordExpired(
    transaction: DatabaseTransaction,
    grant: RawGrant,
    correlationId: string,
    at: Date,
  ): Promise<void> {
    await this.audit.append(
      {
        organizationId: grant.organizationId,
        actionKey: AUDIT_ACTION_KEYS.temporaryAccessExpired,
        actorSnapshot: { type: "system" },
        targetType: "temporary-access-grant",
        targetId: grant.id,
        targetSnapshot: snapshot(grant.recipientSnapshot),
        changeDelta: { changedFields: ["status"] },
        ...(grant.approvalReference
          ? { approvalReference: grant.approvalReference }
          : {}),
        ...this.history(correlationId),
        occurredAt: at,
      },
      transaction,
    );
    await this.outbox(
      transaction,
      TEMPORARY_ACCESS_EVENTS.expired,
      grant,
      correlationId,
      at,
    );
  }

  private history(correlationId: string): {
    readonly requestId?: string;
    readonly correlationId: string;
  } {
    const current = this.context.get();
    return {
      ...(current?.requestId ? { requestId: current.requestId } : {}),
      correlationId: current?.correlationId ?? correlationId,
    };
  }

  private outbox(
    transaction: DatabaseTransaction,
    contract: { readonly eventType: string; readonly eventVersion: number },
    grant: RawGrant,
    correlationId: string,
    at: Date,
  ) {
    const history = this.history(correlationId);
    return persistOutboxEvent(transaction, {
      eventType: contract.eventType,
      eventVersion: contract.eventVersion,
      organizationId: grant.organizationId,
      correlationId: history.correlationId,
      ...(history.requestId ? { causationId: history.requestId } : {}),
      occurredAt: at,
      payload: {
        temporaryAccessGrantId: grant.id,
        issuerEmployeeId: grant.issuerEmployeeId,
        recipientEmployeeId: grant.recipientEmployeeId,
        permissionCount: grant.bindings.length,
        startsAt: grant.startsAt.toISOString(),
        expiresAt: grant.expiresAt.toISOString(),
        ...(grant.approvalReference
          ? { approvalReference: grant.approvalReference }
          : {}),
      },
    });
  }
}
