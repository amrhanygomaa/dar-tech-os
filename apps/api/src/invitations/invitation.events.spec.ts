import { describe, expect, it } from 'vitest';
import { IDENTITY_EVENT_CONTRACTS } from '../identity/identity.events.js';
import { INVITATION_EVENT_CONTRACTS } from './invitation.events.js';

describe('S02-T02 invitation event contracts', () => {
  it('defines the five versioned invitation/onboarding events and reuses the canonical identity-link contract', () => {
    expect(INVITATION_EVENT_CONTRACTS).toMatchObject({
      employeeInvited: { name: 'EmployeeInvited.v1', eventVersion: 1 },
      invitationAccepted: { name: 'InvitationAccepted.v1', eventVersion: 1 },
      invitationRevoked: { name: 'InvitationRevoked.v1', eventVersion: 1 },
      invitationExpired: { name: 'InvitationExpired.v1', eventVersion: 1 },
      onboardingCompleted: { name: 'OnboardingCompleted.v1', eventVersion: 1 },
    });
    expect(INVITATION_EVENT_CONTRACTS.ssoIdentityLinked).toBe(
      IDENTITY_EVENT_CONTRACTS.ssoIdentityLinked,
    );
  });

  it('uses only registered identity event routes and exposes no secret-bearing contract name', () => {
    for (const contract of Object.values(INVITATION_EVENT_CONTRACTS)) {
      expect(contract.eventType).toMatch(/^identity\.[a-z-]+$/u);
    }
    expect(JSON.stringify(INVITATION_EVENT_CONTRACTS)).not.toMatch(
      /token|secret|acceptance[-_ ]?url|email/iu,
    );
  });
});
