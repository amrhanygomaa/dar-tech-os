import { Writable } from 'node:stream';
import type { INestApplication } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { ApiConfig } from '@dar-tech/config';
import {
  createPrismaClient,
  EmployeeLifecycleStatus,
  Prisma,
  type DatabaseClient,
} from '@dar-tech/database';
import { RequestContextStore, StructuredLogger } from '@dar-tech/observability';
import { AppModule } from '../app.module.js';
import { configureApiFoundation } from '../platform/configure-api-foundation.js';
import { PrismaAuthenticationIdentityRepository } from '../auth/prisma-auth-identity.repository.js';
import type { TrustedActor } from './identity.contracts.js';
import { PrismaIdentityRepository } from './prisma-identity.repository.js';

const databaseUrl = process.env.TEST_DATABASE_URL;
const orgAId = '018f53d4-2f68-7c52-a399-3df2364d8601';
const orgBId = '018f53d4-2f68-7c52-a399-3df2364d8602';
const actorEmployeeId = '018f53d4-2f68-7c52-a399-3df2364d8611';
const targetEmployeeId = '018f53d4-2f68-7c52-a399-3df2364d8612';
const orgBEmployeeId = '018f53d4-2f68-7c52-a399-3df2364d8613';
const actorAccountId = '018f53d4-2f68-7c52-a399-3df2364d8621';
const orgBAccountId = '018f53d4-2f68-7c52-a399-3df2364d8622';
const orgASSOId = '018f53d4-2f68-7c52-a399-3df2364d8631';
const orgBSSOId = '018f53d4-2f68-7c52-a399-3df2364d8632';
const actor: TrustedActor = {
  actorType: 'employee',
  organizationId: orgAId,
  employeeId: actorEmployeeId,
  userAccountId: actorAccountId,
};

async function clearIdentityData(client: DatabaseClient): Promise<void> {
  await client.$executeRawUnsafe('TRUNCATE TABLE "audit_events", "security_events"');
  await client.sSOIdentity.deleteMany();
  await client.userAccount.deleteMany();
  await client.employee.deleteMany();
  await client.organization.deleteMany();
}

async function createFixtures(client: DatabaseClient): Promise<void> {
  await client.organization.createMany({
    data: [
      { id: orgAId, displayName: 'Organization A' },
      { id: orgBId, displayName: 'Organization B' },
    ],
  });
  await client.employee.createMany({
    data: [
      {
        id: actorEmployeeId,
        organizationId: orgAId,
        employeeCode: 'A-001',
        firstName: 'Actor',
        lastName: 'Employee',
        displayName: 'Actor Employee',
        workEmail: 'actor@orga.example',
        lifecycleStatus: EmployeeLifecycleStatus.ACTIVE,
        activatedAt: new Date('2026-09-01T08:00:00.000Z'),
      },
      {
        id: targetEmployeeId,
        organizationId: orgAId,
        employeeCode: 'A-002',
        firstName: 'Target',
        lastName: 'Employee',
        displayName: 'Target Employee',
        workEmail: 'target@orga.example',
      },
      {
        id: orgBEmployeeId,
        organizationId: orgBId,
        employeeCode: 'B-001',
        firstName: 'Other',
        lastName: 'Employee',
        displayName: 'Other Employee',
        workEmail: 'employee@orgb.example',
      },
    ],
  });
  await client.userAccount.createMany({
    data: [
      {
        id: actorAccountId,
        organizationId: orgAId,
        employeeId: actorEmployeeId,
        authenticationEligible: true,
        activatedAt: new Date('2026-09-01T08:00:00.000Z'),
      },
      {
        id: orgBAccountId,
        organizationId: orgBId,
        employeeId: orgBEmployeeId,
      },
    ],
  });
  await client.sSOIdentity.createMany({
    data: [
      {
        id: orgASSOId,
        organizationId: orgAId,
        userAccountId: actorAccountId,
        providerKey: 'microsoft-entra',
        providerSubject: 'subject-org-a',
        verifiedEmailNormalized: 'actor@orga.example',
      },
      {
        id: orgBSSOId,
        organizationId: orgBId,
        userAccountId: orgBAccountId,
        providerKey: 'microsoft-entra',
        providerSubject: 'subject-org-b',
        verifiedEmailNormalized: 'employee@orgb.example',
      },
    ],
  });
}

describe.skipIf(!databaseUrl)('S02-T01 identity PostgreSQL and API integration', () => {
  let client: DatabaseClient;
  let repository: PrismaIdentityRepository;
  let authenticationRepository: PrismaAuthenticationIdentityRepository;
  let app: INestApplication;

  beforeAll(async () => {
    client = createPrismaClient({ databaseUrl: databaseUrl as string });
    repository = new PrismaIdentityRepository(client);
    authenticationRepository = new PrismaAuthenticationIdentityRepository(client);
    const destination = new Writable({
      write(_chunk, _encoding, callback) {
        callback();
      },
    });
    const contextStore = new RequestContextStore();
    const logger = new StructuredLogger(contextStore, {
      runtime: 'api',
      environment: 'test',
      level: 'fatal',
      destination,
    });
    const config: ApiConfig = {
      runtime: 'api',
      appEnvironment: 'test',
      nodeEnvironment: 'test',
      logLevel: 'fatal',
      port: 3001,
      databaseUrl: databaseUrl as string,
      databasePoolMax: 2,
      databaseConnectTimeoutMs: 2_000,
      databaseIdleTimeoutMs: 2_000,
      authentication: {
        allowedRedirectUris: [],
        localProviderEnabled: false,
        localIdentities: [],
        transactionTtlSeconds: 300,
      },
    };
    app = await NestFactory.create(
      AppModule.register(
        config,
        { contextStore, logger },
        {
          identityTestAdapters: {
            actors: { currentActor: () => Promise.resolve(actor) },
            authorization: { authorize: () => Promise.resolve(true) },
          },
        },
      ),
      { logger },
    );
    configureApiFoundation(app, contextStore, logger);
    await app.init();
  });

  beforeEach(async () => {
    await clearIdentityData(client);
    await createFixtures(client);
  });

  afterAll(async () => {
    if (client) await clearIdentityData(client);
    if (app) await app.close();
    if (client) await client.$disconnect();
  });

  it('persists the four organization-scoped entities and canonical lifecycle enum', async () => {
    await expect(client.organization.count()).resolves.toBe(2);
    await expect(client.employee.count()).resolves.toBe(3);
    await expect(client.userAccount.count()).resolves.toBe(2);
    await expect(client.sSOIdentity.count()).resolves.toBe(2);

    const lifecycleValues = await client.$queryRaw<Array<{ value: string }>>(Prisma.sql`
      SELECT unnest(enum_range(NULL::employee_lifecycle_status))::text AS value
    `);
    expect(lifecycleValues.map(({ value }) => value)).toEqual([
      'INVITED',
      'ACTIVE',
      'SUSPENDED',
      'OFFBOARDING',
      'ARCHIVED',
    ]);
  });

  it('installs organization-scoped indexes and restrictive foreign keys', async () => {
    const indexes = await client.$queryRaw<Array<{ indexname: string }>>(Prisma.sql`
      SELECT indexname
      FROM pg_indexes
      WHERE schemaname = 'public'
        AND tablename IN ('employees', 'user_accounts', 'sso_identities')
    `);
    expect(indexes.map(({ indexname }) => indexname)).toEqual(
      expect.arrayContaining([
        'employees_organization_lifecycle_created_at_idx',
        'employees_organization_work_email_idx',
        'user_accounts_organization_authentication_eligible_idx',
        'sso_identities_organization_account_idx',
        'sso_identities_organization_verified_email_idx',
        'sso_identities_provider_subject_key',
      ]),
    );

    const identityForeignKeys = await client.$queryRaw<
      Array<{ constraint_name: string; delete_action: string }>
    >(Prisma.sql`
      SELECT tc.constraint_name, rc.delete_rule AS delete_action
      FROM information_schema.table_constraints tc
      JOIN information_schema.referential_constraints rc
        ON rc.constraint_schema = tc.constraint_schema
       AND rc.constraint_name = tc.constraint_name
      WHERE tc.constraint_schema = 'public'
        AND tc.constraint_type = 'FOREIGN KEY'
        AND tc.table_name IN ('employees', 'user_accounts', 'sso_identities')
    `);
    expect(identityForeignKeys).toHaveLength(5);
    expect(identityForeignKeys.every(({ delete_action }) => delete_action === 'RESTRICT')).toBe(
      true,
    );
  });

  it('does not create password or provider-credential storage columns', async () => {
    const columns = await client.$queryRaw<Array<{ column_name: string }>>(Prisma.sql`
      SELECT column_name
      FROM information_schema.columns
      WHERE table_schema = 'public'
        AND table_name IN ('user_accounts', 'sso_identities')
    `);
    const names = columns.map(({ column_name }) => column_name);
    for (const forbidden of [
      'password',
      'password_hash',
      'access_token',
      'refresh_token',
      'authorization_code',
      'provider_secret',
    ]) {
      expect(names).not.toContain(forbidden);
    }
  });

  it('enforces one internal account per employee and organization-matched relations', async () => {
    await expect(
      client.userAccount.create({
        data: {
          organizationId: orgAId,
          employeeId: actorEmployeeId,
        },
      }),
    ).rejects.toBeTruthy();
    await expect(
      client.userAccount.create({
        data: {
          organizationId: orgBId,
          employeeId: targetEmployeeId,
        },
      }),
    ).rejects.toBeTruthy();
  });

  it('prevents provider-subject reuse and cross-organization account linkage', async () => {
    await expect(
      client.sSOIdentity.create({
        data: {
          organizationId: orgBId,
          userAccountId: orgBAccountId,
          providerKey: 'microsoft-entra',
          providerSubject: 'subject-org-a',
        },
      }),
    ).rejects.toBeTruthy();
    await expect(
      client.sSOIdentity.create({
        data: {
          organizationId: orgBId,
          userAccountId: actorAccountId,
          providerKey: 'different-provider',
          providerSubject: 'different-subject',
        },
      }),
    ).rejects.toBeTruthy();
  });

  it('uses restrictive historical references instead of employee cascades', async () => {
    await expect(client.employee.delete({ where: { id: actorEmployeeId } })).rejects.toBeTruthy();
    await expect(client.employee.findUnique({ where: { id: actorEmployeeId } })).resolves.toBeTruthy();
    await expect(client.userAccount.findUnique({ where: { id: actorAccountId } })).resolves.toBeTruthy();
  });

  it('requires organization scope for employee read and update repository operations', async () => {
    await expect(repository.findEmployeeById(orgAId, orgBEmployeeId)).resolves.toBeNull();
    await expect(
      repository.updateEmployeeProfile(orgAId, orgBEmployeeId, { displayName: 'Leaked' }),
    ).resolves.toBeNull();
    const untouched = await client.employee.findUniqueOrThrow({ where: { id: orgBEmployeeId } });
    expect(untouched.displayName).toBe('Other Employee');
  });

  it('does not expose an account or SSO identity through another organization', async () => {
    await expect(repository.findAccountById(orgAId, orgBAccountId)).resolves.toBeNull();
    await expect(
      repository.findSSOIdentity(orgAId, ' MICROSOFT-ENTRA ', ' subject-org-b '),
    ).resolves.toBeNull();
    await expect(
      repository.findSSOIdentity(orgAId, ' MICROSOFT-ENTRA ', ' subject-org-a '),
    ).resolves.toMatchObject({ id: orgASSOId, organizationId: orgAId });
  });

  it('resolves linked authentication eligibility from the canonical T01 identity tuple', async () => {
    await expect(
      authenticationRepository.findLinkedIdentity(' MICROSOFT-ENTRA ', ' subject-org-a '),
    ).resolves.toMatchObject({
      ssoIdentityId: orgASSOId,
      organizationId: orgAId,
      userAccount: {
        id: actorAccountId,
        organizationId: orgAId,
        employeeId: actorEmployeeId,
        authenticationEligible: true,
        disabledAt: null,
      },
      employee: {
        id: actorEmployeeId,
        organizationId: orgAId,
        lifecycleStatus: 'ACTIVE',
      },
    });
    await expect(
      authenticationRepository.findLinkedIdentity('microsoft-entra', 'unknown-subject'),
    ).resolves.toBeNull();
  });

  it('lists and fetches only employees in the trusted actor organization', async () => {
    const list = await request(app.getHttpServer()).get('/api/v1/employees').expect(200);
    expect(list.body.data.total).toBe(2);
    expect(list.body.data.items.map((item: { id: string }) => item.id)).not.toContain(
      orgBEmployeeId,
    );
    expect(list.body.meta.requestId).toBe(list.headers['x-request-id']);

    const hidden = await request(app.getHttpServer())
      .get(`/api/v1/employees/${orgBEmployeeId}`)
      .expect(404);
    expect(hidden.body.error).toEqual({
      code: 'NOT_FOUND',
      message: 'Resource not found',
      requestId: hidden.headers['x-request-id'],
    });
  });

  it('allows normalized profile updates and records safe audit context', async () => {
    const response = await request(app.getHttpServer())
      .patch(`/api/v1/employees/${targetEmployeeId}`)
      .send({ displayName: ' Updated   Employee ', workEmail: ' UPDATED@ORGA.EXAMPLE ' })
      .expect(200);

    expect(response.body.data).toMatchObject({
      id: targetEmployeeId,
      organizationId: orgAId,
      displayName: 'Updated Employee',
      workEmail: 'updated@orga.example',
      lifecycleStatus: 'INVITED',
    });
    await expect(
      client.auditEvent.findFirstOrThrow({
        where: { organizationId: orgAId, actionKey: 'admin.employee.update' },
      }),
    ).resolves.toMatchObject({
      actionKey: 'admin.employee.update',
      actorEmployeeId,
      targetId: targetEmployeeId,
      organizationId: orgAId,
      requestId: response.headers['x-request-id'],
      actorSnapshot: {
        type: 'employee',
        displayName: 'Actor Employee',
        employeeCode: 'A-001',
      },
      targetSnapshot: {
        displayName: 'Target Employee',
        employeeCode: 'A-002',
      },
      changeDelta: { changedFields: ['displayName', 'workEmail'] },
    });
  });

  it('rejects lifecycle and account-state fields through generic PATCH', async () => {
    for (const body of [
      { status: 'ACTIVE' },
      { lifecycleStatus: 'ACTIVE' },
      { lifecycle_status: 'ACTIVE' },
      { authenticationEligible: true },
    ]) {
      const response = await request(app.getHttpServer())
        .patch(`/api/v1/employees/${targetEmployeeId}`)
        .send(body)
        .expect(422);
      expect(response.body.error).toMatchObject({
        code: 'IDENTITY_LIFECYCLE_MUTATION_NOT_ALLOWED',
        requestId: response.headers['x-request-id'],
      });
    }
    const unchanged = await client.employee.findUniqueOrThrow({ where: { id: targetEmployeeId } });
    expect(unchanged.lifecycleStatus).toBe(EmployeeLifecycleStatus.INVITED);
  });

  it('supports the trusted self contract without accepting organization input', async () => {
    const me = await request(app.getHttpServer()).get('/api/v1/me').expect(200);
    expect(me.body.data).toMatchObject({
      organization: { id: orgAId, displayName: 'Organization A' },
      employee: { id: actorEmployeeId, organizationId: orgAId },
      userAccount: { id: actorAccountId, organizationId: orgAId },
    });

    const updated = await request(app.getHttpServer())
      .patch('/api/v1/me')
      .send({ displayName: ' Updated   Self ' })
      .expect(200);
    expect(updated.body.data.employee.displayName).toBe('Updated Self');

    const rejected = await request(app.getHttpServer())
      .patch('/api/v1/me')
      .send({ organizationId: orgBId })
      .expect(422);
    expect(rejected.body.error.code).toBe('IDENTITY_UPDATE_INVALID');
  });

  it('fails safely when an Org A actor attempts to update an Org B identifier', async () => {
    const response = await request(app.getHttpServer())
      .patch(`/api/v1/employees/${orgBEmployeeId}`)
      .send({ displayName: 'Cross Organization' })
      .expect(404);
    expect(response.body.error).toEqual({
      code: 'NOT_FOUND',
      message: 'Resource not found',
      requestId: response.headers['x-request-id'],
    });
    const untouched = await client.employee.findUniqueOrThrow({ where: { id: orgBEmployeeId } });
    expect(untouched.displayName).toBe('Other Employee');
  });
});
