export const SESSION_EVENT_CONTRACTS = {
  sessionCreated: {
    name: 'SessionCreated.v1',
    eventType: 'identity.session-created',
    eventVersion: 1,
  },
  sessionRevoked: {
    name: 'SessionRevoked.v1',
    eventType: 'identity.session-revoked',
    eventVersion: 1,
  },
  allSessionsRevoked: {
    name: 'AllSessionsRevoked.v1',
    eventType: 'identity.all-sessions-revoked',
    eventVersion: 1,
  },
} as const;
