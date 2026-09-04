import { describe, expect, it, vi } from 'vitest';
import type { SessionPrincipal } from '../sessions/session.contracts.js';
import { CentralSessionAuthorizationAdapter } from './authorization.adapters.js';
import { AuthorizationActorContext } from './authorization-context.js';
import type {
  AuthorizationActor,
  AuthorizationGrant,
  AuthorizationGrantRepository,
  AuthorizationMetricsPort,
  AuthorizationPolicyEvaluator,
  AuthorizationPolicyInput,
} from './authorization.contracts.js';
import { AuthorizationService } from './authorization.service.js';

const requestTime = new Date('2026-09-04T12:00:00.000Z');
const authenticatedAt = new Date('2026-09-04T10:00:00.000Z');
const trustedActor: AuthorizationActor = {
  actorType: 'employee',
  sessionId: 'session-a',
  organizationId: 'organization-a',
  employeeId: 'employee-a',
  userAccountId: 'account-a',
  clientKind: 'browser',
  assuranceLevel: 'password',
  authenticatedAt,
  lastStepUpAt: null,
  issuedAt: new Date('2026-09-04T09:59:00.000Z'),
  lastSeenAt: new Date('2026-09-04T11:59:00.000Z'),
  idleExpiresAt: new Date('2026-09-04T12:05:00.000Z'),
  absoluteExpiresAt: new Date('2026-09-04T18:00:00.000Z'),
};
const suppliedActor: SessionPrincipal = {
  ...trustedActor,
  assuranceLevel: 'phishing-resistant',
  authenticatedAt: new Date('2026-09-04T11:59:58.000Z'),
  lastStepUpAt: new Date('2026-09-04T11:59:59.000Z'),
  issuedAt: new Date('2026-09-04T11:59:57.000Z'),
  lastSeenAt: new Date('2026-09-04T11:59:59.000Z'),
  idleExpiresAt: new Date('2026-09-05T12:00:00.000Z'),
  absoluteExpiresAt: new Date('2026-09-05T12:00:00.000Z'),
};
const grant: AuthorizationGrant = {
  permissionKey: 'identity.session.read_self',
  riskClassification: 'LOW',
  scopeType: 'SELF',
  scopeBindingType: null,
  scopeBindingId: null,
};
const resource = {
  type: 'session' as const,
  organizationId: trustedActor.organizationId,
  id: trustedActor.sessionId,
  ownerEmployeeId: trustedActor.employeeId,
  ownerUserAccountId: trustedActor.userAccountId,
};

describe('CentralSessionAuthorizationAdapter trusted principal boundary', () => {
  it('passes only request-local T04 metadata to policy when caller metadata is forged', async () => {
    let policyInput: AuthorizationPolicyInput | undefined;
    const policyEvaluator: AuthorizationPolicyEvaluator = {
      evaluatePolicy: vi.fn(async (input) => {
        policyInput = input;
        return {
          allowed:
            input.actor.assuranceLevel === trustedActor.assuranceLevel &&
            input.actor.lastStepUpAt === trustedActor.lastStepUpAt,
        };
      }),
    };
    const grants: AuthorizationGrantRepository = {
      listEffectivePermissionGrantsForEmployee: vi.fn(async () => [grant]),
    };
    const metrics: AuthorizationMetricsPort = { record: vi.fn() };
    const authorization = new AuthorizationService(
      grants,
      [],
      metrics,
      undefined,
      undefined,
      policyEvaluator,
    );
    const context = new AuthorizationActorContext();
    const adapter = new CentralSessionAuthorizationAdapter(
      context,
      authorization,
      { now: () => requestTime },
    );

    await expect(
      context.run(trustedActor, () =>
        adapter.allows({ actor: suppliedActor, action: grant.permissionKey, resource }),
      ),
    ).resolves.toBe(true);
    expect(policyInput?.actor).toBe(trustedActor);
    expect(policyInput?.actor).toMatchObject({
      assuranceLevel: 'password',
      authenticatedAt,
      lastStepUpAt: null,
      issuedAt: trustedActor.issuedAt,
      lastSeenAt: trustedActor.lastSeenAt,
      idleExpiresAt: trustedActor.idleExpiresAt,
      absoluteExpiresAt: trustedActor.absoluteExpiresAt,
    });
  });

  it('denies every caller whose session, organization, employee, or account identity differs', async () => {
    const authorization = {
      authorize: vi.fn(async () => ({ allowed: true })),
    } as unknown as AuthorizationService;
    const context = new AuthorizationActorContext();
    const adapter = new CentralSessionAuthorizationAdapter(
      context,
      authorization,
      { now: () => requestTime },
    );
    const mismatches: readonly SessionPrincipal[] = [
      { ...suppliedActor, sessionId: 'session-b' },
      { ...suppliedActor, organizationId: 'organization-b' },
      { ...suppliedActor, employeeId: 'employee-b' },
      { ...suppliedActor, userAccountId: 'account-b' },
    ];

    for (const actor of mismatches) {
      await expect(
        context.run(trustedActor, () =>
          adapter.allows({ actor, action: grant.permissionKey, resource }),
        ),
      ).resolves.toBe(false);
    }
    expect(authorization.authorize).not.toHaveBeenCalled();
  });
});
