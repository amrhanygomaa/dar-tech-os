import { describe, expect, it } from 'vitest';
import {
  lifecycleFingerprint,
  parseArchiveBody,
  parseLifecycleEmployeeId,
  parseLifecycleReasonBody,
} from './offboarding-input.js';

const employeeId = '6e81b130-1e23-4f31-8f15-9f06c0fef433';

describe('S02-T13 lifecycle command input', () => {
  it('trims a bounded reason and accepts only an optional UUID approval reference', () => {
    expect(parseLifecycleEmployeeId(employeeId.toUpperCase())).toBe(employeeId);
    expect(parseLifecycleReasonBody({ reason: '  Employment ended  ', approvalReference: employeeId })).toEqual({
      reason: 'Employment ended',
      approvalReference: employeeId,
    });
  });

  it.each([
    undefined,
    {},
    { reason: '' },
    { reason: 'x'.repeat(501) },
    { reason: 'unsafe\nreason' },
    { reason: 'valid', organizationId: employeeId },
    { reason: 'valid', lifecycleStatus: 'ARCHIVED' },
    { reason: 'valid', approvalReference: 'not-a-uuid' },
  ])('rejects missing, unbounded, control-character, unknown, and forged fields: %j', (body) => {
    expect(() => parseLifecycleReasonBody(body)).toThrow();
  });

  it('accepts only an absent or empty archive body', () => {
    expect(() => parseArchiveBody(undefined)).not.toThrow();
    expect(() => parseArchiveBody({})).not.toThrow();
    expect(() => parseArchiveBody({ status: 'ARCHIVED' })).toThrow();
  });

  it('uses deterministic, context-sensitive SHA-256 fingerprints', () => {
    expect(lifecycleFingerprint('org', 'employee', 'offboard')).toMatch(/^[a-f0-9]{64}$/u);
    expect(lifecycleFingerprint('org', 'employee', 'offboard')).toBe(
      lifecycleFingerprint('org', 'employee', 'offboard'),
    );
    expect(lifecycleFingerprint('org', 'employee', 'offboard')).not.toBe(
      lifecycleFingerprint('org', 'employee', 'suspend'),
    );
  });
});
