import { describe, expect, it } from 'vitest';
import {
  normalizeInvitationEmail,
  parseInvitationPagination,
  parseInvitationSecretBody,
  parseInviteEmployee,
  parseOnboardingStart,
  parseRevocation,
} from './invitation-input.js';

describe('invitation input boundaries', () => {
  it('accepts only the T01 identity fields and normalizes email and names', () => {
    expect(
      parseInviteEmployee({
        employeeCode: ' DT-004 ',
        firstName: ' Amr ',
        lastName: ' Gomaa ',
        displayName: ' Amr   Gomaa ',
        workEmail: ' AMR@EXAMPLE.COM ',
      }),
    ).toEqual({
      employeeCode: 'DT-004',
      firstName: 'Amr',
      lastName: 'Gomaa',
      displayName: 'Amr Gomaa',
      workEmail: 'amr@example.com',
    });
    expect(normalizeInvitationEmail('USER@EXAMPLE.COM')).toBe('user@example.com');
  });

  it('rejects caller organization authority, HR fields, and lifecycle controls', () => {
    const base = {
      employeeCode: 'DT-004',
      firstName: 'Amr',
      lastName: 'Gomaa',
      displayName: 'Amr Gomaa',
      workEmail: 'amr@example.com',
    };
    for (const extra of ['organizationId', 'role', 'jobTitle', 'lifecycleStatus', 'password']) {
      expect(() => parseInviteEmployee({ ...base, [extra]: 'not-authority' })).toThrow();
    }
  });

  it('accepts invitation secrets only in bodies and bounds management input', () => {
    expect(parseInvitationSecretBody({ invitationToken: 'opaque' })).toBe('opaque');
    expect(
      parseOnboardingStart({
        invitationToken: 'opaque',
        redirectUri: 'https://portal.example/onboarding/callback/provider',
      }),
    ).toMatchObject({ invitationToken: 'opaque' });
    expect(parseInvitationPagination(undefined, undefined)).toEqual({ page: 1, pageSize: 50 });
    expect(() => parseInvitationPagination('1', '101')).toThrow();
    expect(() => parseInvitationSecretBody({ token: 'query-style' })).toThrow();
  });

  it('accepts an optional safe revocation reason and rejects likely secret material', () => {
    expect(parseRevocation({ reason: 'Recipient changed teams' })).toEqual({
      safeReason: 'Recipient changed teams',
    });
    expect(() => parseRevocation({ reason: `invite=${'a'.repeat(43)}` })).toThrow();
  });
});
