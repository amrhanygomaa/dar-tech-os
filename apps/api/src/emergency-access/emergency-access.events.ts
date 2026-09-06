export const EMERGENCY_ACCESS_EVENTS = {
  requested: { name: 'EmergencyAccessRequested.v1', eventType: 'identity.emergency-access-requested', eventVersion: 1 },
  activated: { name: 'EmergencyAccessActivated.v1', eventType: 'identity.emergency-access-activated', eventVersion: 1 },
  denied: { name: 'EmergencyAccessDenied.v1', eventType: 'identity.emergency-access-denied', eventVersion: 1 },
  used: { name: 'EmergencyAccessUsed.v1', eventType: 'identity.emergency-access-used', eventVersion: 1 },
  revoked: { name: 'EmergencyAccessRevoked.v1', eventType: 'identity.emergency-access-revoked', eventVersion: 1 },
  expired: { name: 'EmergencyAccessExpired.v1', eventType: 'identity.emergency-access-expired', eventVersion: 1 },
} as const;
