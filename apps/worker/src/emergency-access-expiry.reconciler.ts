import { randomUUID } from 'node:crypto';
import { Inject, Injectable } from '@nestjs/common';
import { DATABASE_CLIENT, type DatabaseClient, type Prisma, runInTransaction } from '@dar-tech/database';
import { persistOutboxEvent } from '@dar-tech/outbox';

@Injectable()
export class EmergencyAccessExpiryReconciler {
  constructor(@Inject(DATABASE_CLIENT) private readonly client: DatabaseClient) {}

  async reconcile(now = new Date()): Promise<number> {
    const candidates = await this.client.emergencyAccessGrant.findMany({
      where: { status: 'ACTIVE', expiresAt: { lte: now } },
      orderBy: [{ expiresAt: 'asc' }, { id: 'asc' }],
      select: { id: true, organizationId: true },
      take: 25,
    });
    let changed = 0;
    for (const candidate of candidates) {
      changed += await runInTransaction(this.client, async (transaction) => {
        await transaction.$queryRaw`SELECT id FROM emergency_access_grants WHERE id = ${candidate.id}::uuid AND organization_id = ${candidate.organizationId}::uuid FOR UPDATE`;
        const grant = await transaction.emergencyAccessGrant.findFirst({
          where: { id: candidate.id, organizationId: candidate.organizationId },
          include: { bindings: { select: { id: true } } },
        });
        if (!grant || grant.status !== 'ACTIVE' || grant.expiresAt > now) return 0;
        await transaction.emergencyAccessGrant.update({ where: { id: grant.id }, data: { status: 'EXPIRED', version: { increment: 1 } } });
        const correlationId = randomUUID();
        await transaction.auditEvent.create({
          data: {
            organizationId: grant.organizationId,
            actionKey: 'system.access.emergency.expire',
            actorSnapshot: { type: 'system' },
            targetType: 'emergency-access-grant',
            targetId: grant.id,
            targetSnapshot: grant.recipientSnapshot as Prisma.InputJsonValue,
            changeDelta: { changedFields: ['status'] },
            approvalReference: grant.approvalReference,
            correlationId,
            occurredAt: now,
          },
        });
        await transaction.securityEvent.create({
          data: {
            organizationId: grant.organizationId,
            eventType: 'EmergencyAccessExpired.v1',
            category: 'emergency_access_expired',
            risk: grant.effectiveRisk,
            outcome: 'SUCCEEDED',
            actorSnapshot: { type: 'system' },
            safeContext: {
              grantId: grant.id,
              recipientEmployeeId: grant.recipientEmployeeId,
              effectiveRisk: grant.effectiveRisk,
              permissionCount: grant.bindings.length,
            },
            correlationId,
            occurredAt: now,
          },
        });
        await persistOutboxEvent(transaction, {
          eventType: 'identity.emergency-access-expired',
          eventVersion: 1,
          organizationId: grant.organizationId,
          correlationId,
          occurredAt: now,
          payload: {
            emergencyAccessGrantId: grant.id,
            requesterEmployeeId: grant.requesterEmployeeId,
            recipientEmployeeId: grant.recipientEmployeeId,
            effectiveRisk: grant.effectiveRisk,
            permissionCount: grant.bindings.length,
            startsAt: grant.requestedStartsAt.toISOString(),
            expiresAt: grant.expiresAt.toISOString(),
            ...(grant.approvalReference ? { approvalReference: grant.approvalReference } : {}),
          },
        });
        return 1;
      });
    }
    return changed;
  }
}
