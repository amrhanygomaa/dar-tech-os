import { describe, expect, it, vi } from 'vitest';
import type { DatabaseClient } from '@dar-tech/database';
import type { NormalizedProviderIdentity } from './auth.contracts.js';
import { PrismaInvitationAuthenticationEligibilityAdapter } from './auth-security.adapters.js';

const identity: NormalizedProviderIdentity = {
  providerKey: 'local',
  providerSubject: 'subject-1',
  verifiedEmail: 'employee@example.com',
  emailVerificationStatus: 'verified',
  assurance: { level: 'local-development', methods: ['local-fixture'] },
};

describe('Prisma invitation authentication eligibility adapter', () => {
  it('uses the injected clock for the direct invitation expiry predicate', async () => {
    const now = new Date('2026-09-02T12:05:00.000Z');
    const findFirst = vi.fn().mockResolvedValue(null);
    const client = {
      invitation: { findFirst },
    } as unknown as DatabaseClient;
    const adapter = new PrismaInvitationAuthenticationEligibilityAdapter(client, () => now);

    await expect(
      adapter.authorize(identity, '018f53d4-2f68-7c52-a399-3df2364d8701'),
    ).resolves.toBeNull();
    expect(findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ expiresAt: { gt: now } }),
      }),
    );
  });
});
