import { randomUUID } from "node:crypto";
import { Inject, Injectable } from "@nestjs/common";
import {
  DATABASE_CLIENT,
  type Prisma,
  runInTransaction,
  type DatabaseClient,
} from "@dar-tech/database";
import { persistOutboxEvent } from "@dar-tech/outbox";

@Injectable()
export class TemporaryAccessExpiryReconciler {
  constructor(
    @Inject(DATABASE_CLIENT) private readonly client: DatabaseClient,
  ) {}

  async reconcile(now = new Date()): Promise<number> {
    const candidates = await this.client.temporaryAccessGrant.findMany({
      where: { status: "GRANTED", expiresAt: { lte: now } },
      orderBy: [{ expiresAt: "asc" }, { id: "asc" }],
      select: { id: true, organizationId: true },
      take: 25,
    });
    let changed = 0;
    for (const candidate of candidates) {
      changed += await runInTransaction(this.client, async (transaction) => {
        await transaction.$queryRaw`SELECT id FROM temporary_access_grants WHERE id = ${candidate.id}::uuid AND organization_id = ${candidate.organizationId}::uuid FOR UPDATE`;
        const grant = await transaction.temporaryAccessGrant.findFirst({
          where: { id: candidate.id, organizationId: candidate.organizationId },
          include: { bindings: { select: { id: true } } },
        });
        if (!grant || grant.status !== "GRANTED" || grant.expiresAt > now)
          return 0;
        await transaction.temporaryAccessGrant.update({
          where: { id: grant.id },
          data: { status: "EXPIRED", version: { increment: 1 } },
        });
        const correlationId = randomUUID();
        await transaction.auditEvent.create({
          data: {
            organizationId: grant.organizationId,
            actionKey: "system.access.temporary.expire",
            actorSnapshot: { type: "system" },
            targetType: "temporary-access-grant",
            targetId: grant.id,
            targetSnapshot: grant.recipientSnapshot as Prisma.InputJsonValue,
            changeDelta: { changedFields: ["status"] },
            approvalReference: grant.approvalReference,
            correlationId,
            occurredAt: now,
          },
        });
        await persistOutboxEvent(transaction, {
          eventType: "identity.temporary-access-expired",
          eventVersion: 1,
          organizationId: grant.organizationId,
          correlationId,
          occurredAt: now,
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
        return 1;
      });
    }
    return changed;
  }
}
