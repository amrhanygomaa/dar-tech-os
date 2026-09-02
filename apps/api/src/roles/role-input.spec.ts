import { describe, expect, it } from 'vitest';
import { parseAssignment, parseCreateRole, parseUpdateRole } from './role-input.js';

describe('S02-T05 role input normalization', () => {
  it('normalizes a stable key and deterministic role name', () => {
    expect(parseCreateRole({ key: '  Project-Manager  ', name: '  Project   Manager  ' })).toEqual({
      key: 'project-manager',
      name: 'Project Manager',
      normalizedName: 'project manager',
      description: null,
    });
  });

  it.each(['', 'two words', '-admin', 'admin-', 'admin/*', 'ADMIN\n']) (
    'rejects unsafe or empty role key %j',
    (key) => {
      expect(() => parseCreateRole({ key, name: 'Safe name' })).toThrowError(
        expect.objectContaining({ code: 'ROLE_INPUT_INVALID' }),
      );
    },
  );

  it('rejects control characters and bounded-length violations', () => {
    expect(() => parseCreateRole({ key: 'safe', name: 'Unsafe\nName' })).toThrowError(
      expect.objectContaining({ code: 'ROLE_INPUT_INVALID' }),
    );
    expect(() => parseCreateRole({ key: 'x'.repeat(65), name: 'Name' })).toThrowError(
      expect.objectContaining({ code: 'ROLE_INPUT_INVALID' }),
    );
    expect(() => parseCreateRole({ key: 'safe', name: 'x'.repeat(161) })).toThrowError(
      expect.objectContaining({ code: 'ROLE_INPUT_INVALID' }),
    );
  });

  it('keeps the key outside the PATCH allowlist and rejects lifecycle metadata', () => {
    expect(() => parseUpdateRole({ key: 'renamed' })).toThrowError(
      expect.objectContaining({ code: 'ROLE_KEY_IMMUTABLE' }),
    );
    expect(() => parseUpdateRole({ archivedAt: new Date().toISOString() })).toThrowError(
      expect.objectContaining({ code: 'ROLE_INPUT_INVALID' }),
    );
    expect(() => parseUpdateRole({ organizationId: 'anything' })).toThrowError(
      expect.objectContaining({ code: 'ROLE_INPUT_INVALID' }),
    );
  });

  it('accepts only roleId and optional expiry for an assignment', () => {
    expect(
      parseAssignment({
        roleId: '018f53d4-2f68-7c52-a399-3df2364d9901',
        expiresAt: '2026-09-03T12:00:00.000Z',
      }),
    ).toEqual({
      roleId: '018f53d4-2f68-7c52-a399-3df2364d9901',
      expiresAt: new Date('2026-09-03T12:00:00.000Z'),
    });
    expect(() =>
      parseAssignment({
        roleId: '018f53d4-2f68-7c52-a399-3df2364d9901',
        organizationId: 'untrusted',
      }),
    ).toThrowError(expect.objectContaining({ code: 'ROLE_INPUT_INVALID' }));
  });
});
