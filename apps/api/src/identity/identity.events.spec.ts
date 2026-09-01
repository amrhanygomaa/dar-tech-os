import { describe, expect, it } from 'vitest';
import {
  IDENTITY_EVENT_CONTRACTS,
  type EmployeeCreatedV1Payload,
  type SSOIdentityLinkedV1Payload,
  type UserAccountActivatedV1Payload,
} from './identity.events.js';

describe('S02-T01 event contracts', () => {
  it('defines only the three approved version-one contracts', () => {
    expect(IDENTITY_EVENT_CONTRACTS).toEqual({
      employeeCreated: {
        name: 'EmployeeCreated.v1',
        eventType: 'identity.employee-created',
        eventVersion: 1,
      },
      ssoIdentityLinked: {
        name: 'SSOIdentityLinked.v1',
        eventType: 'identity.sso-identity-linked',
        eventVersion: 1,
      },
      userAccountActivated: {
        name: 'UserAccountActivated.v1',
        eventType: 'identity.user-account-activated',
        eventVersion: 1,
      },
    });
  });

  it('keeps payloads to organization context, stable IDs, and a provider key', () => {
    const employeeCreated: EmployeeCreatedV1Payload = {
      organizationId: 'organization-id',
      employeeId: 'employee-id',
    };
    const identityLinked: SSOIdentityLinkedV1Payload = {
      organizationId: 'organization-id',
      employeeId: 'employee-id',
      userAccountId: 'account-id',
      ssoIdentityId: 'identity-id',
      providerKey: 'provider-key',
    };
    const accountActivated: UserAccountActivatedV1Payload = {
      organizationId: 'organization-id',
      employeeId: 'employee-id',
      userAccountId: 'account-id',
    };

    const serialized = JSON.stringify({ employeeCreated, identityLinked, accountActivated });
    expect(serialized).not.toMatch(/token|secret|authorizationCode|email|providerSubject/iu);
  });
});
