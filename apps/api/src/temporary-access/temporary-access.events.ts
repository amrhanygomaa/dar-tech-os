export const TEMPORARY_ACCESS_EVENTS = {
  requested: {
    name: "TemporaryAccessRequested.v1",
    eventType: "identity.temporary-access-requested",
    eventVersion: 1,
  },
  granted: {
    name: "TemporaryAccessGranted.v1",
    eventType: "identity.temporary-access-granted",
    eventVersion: 1,
  },
  revoked: {
    name: "TemporaryAccessRevoked.v1",
    eventType: "identity.temporary-access-revoked",
    eventVersion: 1,
  },
  expired: {
    name: "TemporaryAccessExpired.v1",
    eventType: "identity.temporary-access-expired",
    eventVersion: 1,
  },
} as const;
