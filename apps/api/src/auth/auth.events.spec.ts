import { describe, expect, expectTypeOf, it } from 'vitest';
import {
  AUTHENTICATION_EVENT_CONTRACTS,
  type AuthenticationFailedV1Payload,
  type AuthenticationSucceededV1Payload,
  type SSOIdentityLinkedV1Payload,
} from './auth.events.js';
import { IDENTITY_EVENT_CONTRACTS } from '../identity/identity.events.js';

describe('authentication event contracts', () => {
  it('versions the approved contracts and reuses the canonical link event', () => {
    expect(AUTHENTICATION_EVENT_CONTRACTS).toEqual({
      authenticationSucceeded: {
        name: 'AuthenticationSucceeded.v1',
        eventType: 'identity.authentication-succeeded',
        eventVersion: 1,
      },
      authenticationFailed: {
        name: 'AuthenticationFailed.v1',
        eventType: 'identity.authentication-failed',
        eventVersion: 1,
      },
      ssoIdentityLinked: IDENTITY_EVENT_CONTRACTS.ssoIdentityLinked,
    });
  });

  it('keeps tokens, provider subjects, email, state, and nonce out of event payloads', () => {
    const succeeded: AuthenticationSucceededV1Payload = {
      organizationId: 'organization-id',
      employeeId: 'employee-id',
      userAccountId: 'account-id',
      providerKey: 'provider',
      assuranceLevel: 'mfa',
      authenticatedAt: '2026-09-01T12:00:00.000Z',
    };
    const failed: AuthenticationFailedV1Payload = {
      providerKey: 'provider',
      failureCategory: 'protocol_invalid',
    };
    expect(Object.keys(succeeded)).not.toEqual(
      expect.arrayContaining(['providerSubject', 'email', 'state', 'nonce', 'token', 'code']),
    );
    expect(Object.keys(failed)).toEqual(['providerKey', 'failureCategory']);
    expectTypeOf<SSOIdentityLinkedV1Payload>().toMatchTypeOf<{
      organizationId: string;
      employeeId: string;
      userAccountId: string;
      ssoIdentityId: string;
      providerKey: string;
    }>();
  });
});
