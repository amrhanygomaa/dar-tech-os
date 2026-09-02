import { Inject, Injectable } from '@nestjs/common';
import {
  DATABASE_CLIENT,
  type DatabaseClient,
  type DatabaseTransaction,
  type Prisma,
} from '@dar-tech/database';
import type {
  EmployeeDetailView,
  EmployeePage,
  EmployeeProfilePatch,
  EmployeeView,
  IdentityRepositoryPort,
  SelfIdentityView,
  SSOIdentityView,
  UserAccountView,
} from './identity.contracts.js';
import { normalizeProviderKey, normalizeProviderSubject } from './employee-profile.js';

const userAccountSelect = {
  id: true,
  organizationId: true,
  employeeId: true,
  authenticationEligible: true,
  activatedAt: true,
  disabledAt: true,
  createdAt: true,
  updatedAt: true,
} satisfies Prisma.UserAccountSelect;

const employeeSelect = {
  id: true,
  organizationId: true,
  employeeCode: true,
  firstName: true,
  lastName: true,
  displayName: true,
  workEmail: true,
  lifecycleStatus: true,
  invitedAt: true,
  activatedAt: true,
  suspendedAt: true,
  offboardingAt: true,
  archivedAt: true,
  createdAt: true,
  updatedAt: true,
} satisfies Prisma.EmployeeSelect;

const employeeDetailSelect = {
  ...employeeSelect,
  userAccount: { select: userAccountSelect },
} satisfies Prisma.EmployeeSelect;

type RawEmployee = Prisma.EmployeeGetPayload<{ select: typeof employeeSelect }>;
type RawEmployeeDetail = Prisma.EmployeeGetPayload<{ select: typeof employeeDetailSelect }>;
type RawUserAccount = Prisma.UserAccountGetPayload<{ select: typeof userAccountSelect }>;

function employeeView(employee: RawEmployee): EmployeeView {
  return employee;
}

function accountView(account: RawUserAccount): UserAccountView {
  return account;
}

function employeeDetailView(employee: RawEmployeeDetail): EmployeeDetailView {
  return {
    ...employeeView(employee),
    userAccount: employee.userAccount ? accountView(employee.userAccount) : null,
  };
}

@Injectable()
export class PrismaIdentityRepository implements IdentityRepositoryPort {
  constructor(@Inject(DATABASE_CLIENT) private readonly client: DatabaseClient) {}

  async findSelf(
    organizationId: string,
    employeeId: string,
    userAccountId: string,
  ): Promise<SelfIdentityView | null> {
    const account = await this.client.userAccount.findFirst({
      where: {
        id: userAccountId,
        organizationId,
        employeeId,
      },
      select: {
        ...userAccountSelect,
        organization: { select: { id: true, displayName: true } },
        employee: { select: employeeSelect },
      },
    });
    if (!account) return null;
    return {
      organization: account.organization,
      employee: employeeView(account.employee),
      userAccount: accountView(account),
    };
  }

  async listEmployees(
    organizationId: string,
    page: number,
    pageSize: number,
  ): Promise<EmployeePage> {
    const [total, employees] = await this.client.$transaction([
      this.client.employee.count({ where: { organizationId } }),
      this.client.employee.findMany({
        where: { organizationId },
        orderBy: [{ displayName: 'asc' }, { id: 'asc' }],
        skip: (page - 1) * pageSize,
        take: pageSize,
        select: employeeDetailSelect,
      }),
    ]);
    return {
      items: employees.map(employeeDetailView),
      page,
      pageSize,
      total,
    };
  }

  async findEmployeeById(
    organizationId: string,
    employeeId: string,
    transaction?: DatabaseTransaction,
  ): Promise<EmployeeDetailView | null> {
    const database = transaction ?? this.client;
    const employee = await database.employee.findFirst({
      where: { id: employeeId, organizationId },
      select: employeeDetailSelect,
    });
    return employee ? employeeDetailView(employee) : null;
  }

  async updateEmployeeProfile(
    organizationId: string,
    employeeId: string,
    patch: EmployeeProfilePatch,
    transaction?: DatabaseTransaction,
  ): Promise<EmployeeDetailView | null> {
    const database = transaction ?? this.client;
    const updated = await database.employee.updateMany({
      where: { id: employeeId, organizationId },
      data: patch,
    });
    if (updated.count !== 1) return null;
    return this.findEmployeeById(organizationId, employeeId, transaction);
  }

  async findAccountById(
    organizationId: string,
    userAccountId: string,
  ): Promise<UserAccountView | null> {
    const account = await this.client.userAccount.findFirst({
      where: { id: userAccountId, organizationId },
      select: userAccountSelect,
    });
    return account ? accountView(account) : null;
  }

  async findSSOIdentity(
    organizationId: string,
    providerKey: string,
    providerSubject: string,
  ): Promise<SSOIdentityView | null> {
    return this.client.sSOIdentity.findFirst({
      where: {
        organizationId,
        providerKey: normalizeProviderKey(providerKey),
        providerSubject: normalizeProviderSubject(providerSubject),
      },
      select: {
        id: true,
        organizationId: true,
        userAccountId: true,
        providerKey: true,
        providerSubject: true,
        verifiedEmailNormalized: true,
        linkedAt: true,
        lastAuthenticatedAt: true,
      },
    });
  }
}
