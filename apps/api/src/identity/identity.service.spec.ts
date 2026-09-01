import { describe, expect, it, vi } from 'vitest';
import type { StructuredLogger } from '@dar-tech/observability';
import type {
  AuthenticatedActorPort,
  EmployeeDetailView,
  EmployeePage,
  IdentityAuditHook,
  IdentityAuthorizationPort,
  IdentityRepositoryPort,
  SelfIdentityView,
  TrustedActor,
} from './identity.contracts.js';
import { IdentityModule } from './identity.module.js';
import { IdentityService } from './identity.service.js';

const organizationId = '018f53d4-2f68-7c52-a399-3df2364d86a1';
const employeeId = '018f53d4-2f68-7c52-a399-3df2364d86a2';
const accountId = '018f53d4-2f68-7c52-a399-3df2364d86a3';
const now = new Date('2026-09-01T12:00:00.000Z');

const actor: TrustedActor = {
  actorType: 'employee',
  organizationId,
  employeeId,
  userAccountId: accountId,
};

const employee: EmployeeDetailView = {
  id: employeeId,
  organizationId,
  employeeCode: 'DT-001',
  firstName: 'Amr',
  lastName: 'Hassan',
  displayName: 'Amr Hassan',
  workEmail: 'amr@example.com',
  lifecycleStatus: 'ACTIVE',
  invitedAt: now,
  activatedAt: now,
  suspendedAt: null,
  offboardingAt: null,
  archivedAt: null,
  createdAt: now,
  updatedAt: now,
  userAccount: {
    id: accountId,
    organizationId,
    employeeId,
    authenticationEligible: true,
    activatedAt: now,
    disabledAt: null,
    createdAt: now,
    updatedAt: now,
  },
};

const selfView: SelfIdentityView = {
  organization: { id: organizationId, displayName: 'Dar Tech' },
  employee,
  userAccount: employee.userAccount!,
};

interface Harness {
  readonly service: IdentityService;
  readonly repository: IdentityRepositoryPort;
  readonly authorization: IdentityAuthorizationPort;
  readonly audit: IdentityAuditHook;
  readonly loggerInfo: ReturnType<typeof vi.fn>;
}

function harness(options: { actor?: TrustedActor | null; allowed?: boolean } = {}): Harness {
  const currentActor = options.actor === undefined ? actor : options.actor;
  const actors: AuthenticatedActorPort = {
    currentActor: vi.fn().mockResolvedValue(currentActor),
  };
  const authorization: IdentityAuthorizationPort = {
    authorize: vi.fn().mockResolvedValue(options.allowed ?? true),
  };
  const repository: IdentityRepositoryPort = {
    findSelf: vi.fn().mockResolvedValue(selfView),
    listEmployees: vi.fn().mockResolvedValue({
      items: [employee],
      page: 1,
      pageSize: 50,
      total: 1,
    } satisfies EmployeePage),
    findEmployeeById: vi.fn().mockResolvedValue(employee),
    updateEmployeeProfile: vi.fn().mockResolvedValue(employee),
    findAccountById: vi.fn().mockResolvedValue(employee.userAccount),
    findSSOIdentity: vi.fn().mockResolvedValue(null),
  };
  const audit: IdentityAuditHook = { record: vi.fn().mockResolvedValue(undefined) };
  const loggerInfo = vi.fn();
  const logger = { info: loggerInfo, warnEvent: vi.fn() } as unknown as StructuredLogger;
  return {
    service: new IdentityService(actors, authorization, repository, audit, logger),
    repository,
    authorization,
    audit,
    loggerInfo,
  };
}

describe('IdentityService security boundary', () => {
  it('fails closed when no trusted actor is available', async () => {
    const { service, authorization, repository } = harness({ actor: null });

    await expect(service.listEmployees(1, 50)).rejects.toMatchObject({
      code: 'AUTHENTICATION_REQUIRED',
      statusCode: 401,
    });
    expect(authorization.authorize).not.toHaveBeenCalled();
    expect(repository.listEmployees).not.toHaveBeenCalled();
  });

  it('requires an explicit authorization allow decision', async () => {
    const { service, repository } = harness({ allowed: false });

    await expect(service.getEmployee(employeeId)).rejects.toMatchObject({
      code: 'AUTHORIZATION_DENIED',
      statusCode: 403,
    });
    expect(repository.findEmployeeById).not.toHaveBeenCalled();
  });

  it('always derives organization scope from the trusted actor', async () => {
    const { service, repository, authorization } = harness();

    await service.getEmployee(employeeId);

    expect(repository.findEmployeeById).toHaveBeenCalledWith(organizationId, employeeId);
    expect(authorization.authorize).toHaveBeenCalledWith({
      actor,
      action: 'admin.employee.read',
      resource: { type: 'employee', organizationId, id: employeeId },
    });
  });

  it('returns a non-enumerating not-found result for an out-of-scope identifier', async () => {
    const { service, repository } = harness();
    vi.mocked(repository.findEmployeeById).mockResolvedValueOnce(null);

    await expect(service.getEmployee(employeeId)).rejects.toMatchObject({
      code: 'NOT_FOUND',
      statusCode: 404,
      safeMessage: 'Resource not found',
    });
  });

  it('updates only normalized non-lifecycle fields and invokes the audit hook', async () => {
    const { service, repository, audit, loggerInfo } = harness();

    await service.updateEmployee(employeeId, {
      displayName: '  Updated   Name ',
      workEmail: ' UPDATED@EXAMPLE.COM ',
    });

    expect(repository.updateEmployeeProfile).toHaveBeenCalledWith(organizationId, employeeId, {
      displayName: 'Updated Name',
      workEmail: 'updated@example.com',
    });
    expect(audit.record).toHaveBeenCalledWith({
      action: 'admin.employee.update',
      actor,
      targetType: 'employee',
      targetId: employeeId,
      organizationId,
      changedFields: ['displayName', 'workEmail'],
    });
    expect(loggerInfo).toHaveBeenCalledWith(
      'identity.employee.profile_updated',
      expect.objectContaining({ organizationId, targetId: employeeId }),
    );
  });

  it('blocks lifecycle and account-state changes before repository mutation', async () => {
    const { service, repository } = harness();

    await expect(
      service.updateEmployee(employeeId, { lifecycleStatus: 'SUSPENDED' }),
    ).rejects.toMatchObject({
      code: 'IDENTITY_LIFECYCLE_MUTATION_NOT_ALLOWED',
      statusCode: 422,
    });
    await expect(
      service.updateEmployee(employeeId, { authenticationEligible: false }),
    ).rejects.toMatchObject({
      code: 'IDENTITY_LIFECYCLE_MUTATION_NOT_ALLOWED',
      statusCode: 422,
    });
    expect(repository.updateEmployeeProfile).not.toHaveBeenCalled();
  });

  it('limits self-service updates and verifies the actor account tuple', async () => {
    const { service, repository } = harness();

    await service.updateMe({ displayName: ' Self Name ' });

    expect(repository.updateEmployeeProfile).toHaveBeenCalledWith(organizationId, employeeId, {
      displayName: 'Self Name',
    });
    expect(repository.findSelf).toHaveBeenCalledWith(organizationId, employeeId, accountId);
  });

  it('does not make actor metadata such as title or email part of authorization', () => {
    expect(Object.keys(actor).sort()).toEqual([
      'actorType',
      'employeeId',
      'organizationId',
      'userAccountId',
    ]);
  });

  it('prevents test actor adapters from being registered outside test', () => {
    expect(() =>
      IdentityModule.register('production', {
        actors: { currentActor: () => Promise.resolve(actor) },
      }),
    ).toThrow('Identity test adapters are available only in the test environment');
    expect(() =>
      IdentityModule.register('staging', {
        actors: { currentActor: () => Promise.resolve(actor) },
      }),
    ).toThrow('Identity test adapters are available only in the test environment');
  });
});
