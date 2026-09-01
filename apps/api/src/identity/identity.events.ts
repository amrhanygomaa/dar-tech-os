export const IDENTITY_EVENT_CONTRACTS = {
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
} as const;

export interface EmployeeCreatedV1Payload {
  readonly organizationId: string;
  readonly employeeId: string;
}

export interface SSOIdentityLinkedV1Payload {
  readonly organizationId: string;
  readonly employeeId: string;
  readonly userAccountId: string;
  readonly ssoIdentityId: string;
  readonly providerKey: string;
}

export interface UserAccountActivatedV1Payload {
  readonly organizationId: string;
  readonly employeeId: string;
  readonly userAccountId: string;
}
