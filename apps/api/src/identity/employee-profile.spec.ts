import { describe, expect, it } from 'vitest';
import { ApplicationError } from '@dar-tech/observability';
import {
  normalizeProviderKey,
  normalizeProviderSubject,
  normalizeWorkEmail,
  parseEmployeeProfilePatch,
  parseIdentityId,
  parsePagination,
} from './employee-profile.js';

function expectApplicationError(
  operation: () => unknown,
  code: string,
  statusCode: number,
): void {
  try {
    operation();
    throw new Error('Expected operation to fail');
  } catch (error) {
    expect(error).toBeInstanceOf(ApplicationError);
    expect(error).toMatchObject({ code, statusCode });
  }
}

describe('identity input contracts', () => {
  it('normalizes approved administrator profile fields', () => {
    expect(
      parseEmployeeProfilePatch(
        {
          firstName: '  Amr   Hassan ',
          lastName: ' Ali ',
          displayName: ' Amr   H. ',
          workEmail: ' AMR.HASSAN@EXAMPLE.COM ',
        },
        'admin',
      ),
    ).toEqual({
      firstName: 'Amr Hassan',
      lastName: 'Ali',
      displayName: 'Amr H.',
      workEmail: 'amr.hassan@example.com',
    });
  });

  it('limits self-service updates to display name', () => {
    expect(parseEmployeeProfilePatch({ displayName: '  Amr   Hassan  ' }, 'self')).toEqual({
      displayName: 'Amr Hassan',
    });
    expectApplicationError(
      () => parseEmployeeProfilePatch({ workEmail: 'new@example.com' }, 'self'),
      'IDENTITY_UPDATE_INVALID',
      422,
    );
  });

  it.each([
    'status',
    'lifecycleStatus',
    'lifecycle_status',
    'activatedAt',
    'authenticationEligible',
    'disabledAt',
  ])('rejects generic lifecycle mutation field %s with a stable error', (field) => {
    expectApplicationError(
      () => parseEmployeeProfilePatch({ [field]: 'ACTIVE' }, 'admin'),
      'IDENTITY_LIFECYCLE_MUTATION_NOT_ALLOWED',
      422,
    );
  });

  it('rejects empty, unknown, malformed, and overlong profile updates', () => {
    for (const input of [
      {},
      null,
      [],
      { organizationId: 'not-authority' },
      { displayName: ' ' },
      { firstName: 'x'.repeat(101) },
      { workEmail: 'not-an-email' },
    ]) {
      expectApplicationError(
        () => parseEmployeeProfilePatch(input, 'admin'),
        'IDENTITY_UPDATE_INVALID',
        422,
      );
    }
  });

  it('normalizes lookup values without exposing credential concepts', () => {
    expect(normalizeWorkEmail(' Person@Example.COM ')).toBe('person@example.com');
    expect(normalizeProviderKey(' Microsoft-Entra ')).toBe('microsoft-entra');
    expect(normalizeProviderSubject(' subject-123 ')).toBe('subject-123');
  });

  it('validates bounded pagination and UUID route identifiers', () => {
    expect(parsePagination(undefined, undefined)).toEqual({ page: 1, pageSize: 50 });
    expect(parsePagination('2', '100')).toEqual({ page: 2, pageSize: 100 });
    expect(parseIdentityId('018f53d4-2F68-7C52-A399-3DF2364D86AD')).toBe(
      '018f53d4-2f68-7c52-a399-3df2364d86ad',
    );
    expectApplicationError(() => parsePagination('0', '10'), 'INVALID_REQUEST', 400);
    expectApplicationError(() => parsePagination('1', '101'), 'INVALID_REQUEST', 400);
    expectApplicationError(() => parseIdentityId('not-a-uuid'), 'INVALID_REQUEST', 400);
  });
});
