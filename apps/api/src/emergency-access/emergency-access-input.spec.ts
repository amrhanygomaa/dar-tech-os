import { describe, expect, it } from 'vitest';
import { parseEmergencyAccessRequest, riskMaximum } from './emergency-access-input.js';

const now = new Date('2026-09-06T10:00:00.000Z');
const base = {
  recipientEmployeeId: '10000000-0000-4000-8000-000000000002',
  reason: 'Restore a critical internal security control',
  risk: 'HIGH',
  startsAt: '2026-09-06T10:01:00.000Z',
  expiresAt: '2026-09-06T11:01:00.000Z',
  bindings: [{ permissionKey: 'admin.employee.read', scopeType: 'ORGANIZATION', resourceType: 'employee' }],
};

describe('emergency access input', () => {
  it('accepts a bounded exact request and derives the strongest risk', () => {
    expect(parseEmergencyAccessRequest(base, 'request-key-123', now, 14_400)).toMatchObject({
      requestedRisk: 'HIGH',
      bindings: [{ permissionKey: 'admin.employee.read', scopeType: 'ORGANIZATION', resourceId: null }],
    });
    expect(riskMaximum(['LOW', 'CRITICAL', 'HIGH'])).toBe('CRITICAL');
  });

  it.each([
    ['missing reason', { ...base, reason: undefined }],
    ['empty reason', { ...base, reason: ' ' }],
    ['overlong reason', { ...base, reason: 'x'.repeat(501) }],
    ['missing window', { ...base, expiresAt: undefined }],
    ['invalid window', { ...base, expiresAt: base.startsAt }],
    ['expired window', { ...base, expiresAt: '2026-09-06T09:59:00.000Z' }],
    ['invalid risk', { ...base, risk: 'SEVERE' }],
    ['unknown permission', { ...base, bindings: [{ ...base.bindings[0], permissionKey: 'admin.everything' }] }],
    ['wildcard permission', { ...base, bindings: [{ ...base.bindings[0], permissionKey: '*' }] }],
    ['wildcard scope', { ...base, bindings: [{ ...base.bindings[0], scopeType: '*' }] }],
    ['malformed resource', { ...base, bindings: [{ ...base.bindings[0], scopeType: 'EXPLICIT', resourceId: '../secret' }] }],
    ['duplicate binding', { ...base, bindings: [base.bindings[0], base.bindings[0]] }],
    ['client organization', { ...base, organizationId: '10000000-0000-4000-8000-000000000001' }],
    ['client requester', { ...base, requesterEmployeeId: '10000000-0000-4000-8000-000000000003' }],
    ['client policy', { ...base, policy: 'allow' }],
    ['client approver', { ...base, approverId: '10000000-0000-4000-8000-000000000003' }],
    ['client step-up', { ...base, lastStepUpAt: now.toISOString() }],
    ['client credential', { ...base, emergencyToken: 'unsafe' }],
  ])('rejects %s', (_label, value) => {
    expect(() => parseEmergencyAccessRequest(value, 'request-key-123', now, 14_400)).toThrow();
  });

  it('rejects missing, malformed, and materially overlong duration/idempotency data', () => {
    expect(() => parseEmergencyAccessRequest(base, undefined, now, 14_400)).toThrow();
    expect(() => parseEmergencyAccessRequest(base, 'short', now, 14_400)).toThrow();
    expect(() => parseEmergencyAccessRequest({ ...base, expiresAt: '2026-09-07T10:00:00.000Z' }, 'request-key-123', now, 14_400)).toThrow();
  });
});
