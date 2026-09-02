import { Writable } from 'node:stream';
import type { INestApplication } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { ApiConfig } from '@dar-tech/config';
import { createPrismaClient, type DatabaseClient } from '@dar-tech/database';
import { RequestContextStore, StructuredLogger } from '@dar-tech/observability';
import { AppModule } from '../app.module.js';
import type { NormalizedProviderIdentity } from '../auth/auth.contracts.js';
import {
  SECURITY_EVENT_APPEND_PORT,
  type AuditEventAppendPort,
  type SecurityEventAppendPort,
} from '../event-history/event-history.contracts.js';
import { configureApiFoundation } from '../platform/configure-api-foundation.js';
import type { InvitationActor } from './invitation.contracts.js';
import { PrismaInvitationRepository } from './prisma-invitation.repository.js';

const databaseUrl = process.env.TEST_DATABASE_URL;
const organizationAId = '018f53d4-2f68-7c52-a399-3df2364d8801';
const organizationBId = '018f53d4-2f68-7c52-a399-3df2364d8802';
const issuerAId = '018f53d4-2f68-7c52-a399-3df2364d8811';
const issuerBId = '018f53d4-2f68-7c52-a399-3df2364d8812';
const issuerAAccountId = '018f53d4-2f68-7c52-a399-3df2364d8821';
const issuerBAccountId = '018f53d4-2f68-7c52-a399-3df2364d8822';
const redirectUri = 'http://localhost:3000/onboarding/callback/local';

const actorA: InvitationActor = {
  actorType: 'employee',
  organizationId: organizationAId,
  employeeId: issuerAId,
  userAccountId: issuerAAccountId,
};
const actorB: InvitationActor = {
  actorType: 'employee',
  organizationId: organizationBId,
  employeeId: issuerBId,
  userAccountId: issuerBAccountId,
};

const verifiedIdentity: NormalizedProviderIdentity = {
  providerKey: 'local',
  providerSubject: 'onboarding-subject',
  verifiedEmail: 'new.employee@example.com',
  emailVerificationStatus: 'verified',
  assurance: { level: 'local-development', methods: ['local-fixture'] },
  authenticatedAt: new Date('2026-09-02T12:00:01.000Z'),
};

async function clearData(client: DatabaseClient): Promise<void> {
  await client.$executeRawUnsafe('TRUNCATE TABLE "audit_events", "security_events"');
  await client.outboxConsumerReceipt.deleteMany();
  await client.outboxEvent.deleteMany();
  await client.queueJob.deleteMany();
  await client.invitation.deleteMany();
  await client.sSOIdentity.deleteMany();
  await client.userAccount.deleteMany();
  await client.employee.deleteMany();
  await client.organization.deleteMany();
}

async function createActors(client: DatabaseClient): Promise<void> {
  await client.organization.createMany({
    data: [
      { id: organizationAId, displayName: 'Organization A' },
      { id: organizationBId, displayName: 'Organization B' },
    ],
  });
  await client.employee.createMany({
    data: [
      {
        id: issuerAId,
        organizationId: organizationAId,
        employeeCode: 'A-ADMIN',
        firstName: 'A',
        lastName: 'Administrator',
        displayName: 'A Administrator',
        workEmail: 'admin-a@example.com',
        lifecycleStatus: 'ACTIVE',
        activatedAt: new Date('2026-09-01T10:00:00.000Z'),
      },
      {
        id: issuerBId,
        organizationId: organizationBId,
        employeeCode: 'B-ADMIN',
        firstName: 'B',
        lastName: 'Administrator',
        displayName: 'B Administrator',
        workEmail: 'admin-b@example.com',
        lifecycleStatus: 'ACTIVE',
        activatedAt: new Date('2026-09-01T10:00:00.000Z'),
      },
    ],
  });
  await client.userAccount.createMany({
    data: [
      {
        id: issuerAAccountId,
        organizationId: organizationAId,
        employeeId: issuerAId,
        authenticationEligible: true,
        activatedAt: new Date('2026-09-01T10:00:00.000Z'),
      },
      {
        id: issuerBAccountId,
        organizationId: organizationBId,
        employeeId: issuerBId,
        authenticationEligible: true,
        activatedAt: new Date('2026-09-01T10:00:00.000Z'),
      },
    ],
  });
}

describe.skipIf(!databaseUrl)('S02-T02 invitation and onboarding PostgreSQL integration', () => {
  let client: DatabaseClient;
  let app: INestApplication;
  let repository: PrismaInvitationRepository;
  let currentActor: InvitationActor | null = actorA;
  let allowed = true;
  let now: Date;
  let logOutput = '';
  let contextStore: RequestContextStore;
  let logger: StructuredLogger;

  const config: ApiConfig = {
    runtime: 'api',
    appEnvironment: 'test',
    nodeEnvironment: 'test',
    logLevel: 'info',
    port: 3001,
    databaseUrl: databaseUrl as string,
    databasePoolMax: 8,
    databaseConnectTimeoutMs: 2_000,
    databaseIdleTimeoutMs: 2_000,
    authentication: {
      allowedRedirectUris: [redirectUri],
      localProviderEnabled: true,
      localIdentities: [
        {
          loginHint: 'invited',
          providerSubject: verifiedIdentity.providerSubject,
          verifiedEmail: verifiedIdentity.verifiedEmail!,
        },
        {
          loginHint: 'mismatched',
          providerSubject: 'mismatched-subject',
          verifiedEmail: 'different@example.com',
        },
        {
          loginHint: 'missing-email',
          providerSubject: 'missing-email-subject',
        },
      ],
      transactionTtlSeconds: 300,
    },
    invitation: {
      ttlSeconds: 300,
      rateLimitMaxRequests: 1_000,
      rateLimitWindowSeconds: 60,
    },
  };

  beforeAll(async () => {
    client = createPrismaClient({ databaseUrl: databaseUrl as string });
    now = new Date(Date.now() + 5_000);
    contextStore = new RequestContextStore();
    const destination = new Writable({
      write(chunk, _encoding, callback) {
        logOutput += chunk.toString();
        callback();
      },
    });
    logger = new StructuredLogger(contextStore, {
      runtime: 'api',
      environment: 'test',
      level: 'info',
      destination,
    });
    app = await NestFactory.create(
      AppModule.register(
        config,
        { contextStore, logger },
        {
          invitationTestAdapters: {
            actors: { currentActor: () => Promise.resolve(currentActor) },
            authorization: { authorize: () => Promise.resolve(allowed) },
            clock: { now: () => now },
          },
        },
      ),
      { logger },
    );
    configureApiFoundation(app, contextStore, logger);
    await app.init();
    repository = app.get(PrismaInvitationRepository);
  });

  beforeEach(async () => {
    await clearData(client);
    await createActors(client);
    currentActor = actorA;
    allowed = true;
    now = new Date(Date.now() + 5_000);
    logOutput = '';
  });

  afterAll(async () => {
    if (client) await clearData(client);
    if (app) await app.close();
    if (client) await client.$disconnect();
  });

  async function issue(employeeCode = 'A-NEW') {
    const response = await request(app.getHttpServer())
      .post('/api/v1/employees/invite')
      .send({
        employeeCode,
        firstName: 'New',
        lastName: 'Employee',
        displayName: 'New Employee',
        workEmail: 'NEW.EMPLOYEE@EXAMPLE.COM',
      })
      .expect(201);
    const acceptanceUrl = response.body.data.acceptanceUrl as string;
    return {
      response,
      invitation: response.body.data.invitation as {
        id: string;
        employeeId: string;
        userAccountId: string;
      },
      secret: new URL(`https://portal.invalid${acceptanceUrl}`).hash.slice('#invite='.length),
    };
  }

  it('installs the additive invitation enum, constrained schema, indexes, and restrictive ownership links', async () => {
    const enumValues = await client.$queryRaw<Array<{ enumlabel: string }>>`
      SELECT enum_value.enumlabel
      FROM pg_type AS enum_type
      JOIN pg_enum AS enum_value ON enum_value.enumtypid = enum_type.oid
      WHERE enum_type.typname = 'invitation_status'
      ORDER BY enum_value.enumsortorder
    `;
    expect(enumValues.map(({ enumlabel }) => enumlabel)).toEqual([
      'PENDING',
      'ACCEPTED',
      'REVOKED',
      'EXPIRED',
    ]);

    const columns = await client.$queryRaw<Array<{ column_name: string }>>`
      SELECT column_name
      FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = 'invitations'
    `;
    const columnNames = columns.map(({ column_name }) => column_name);
    expect(columnNames).toContain('token_hash');
    expect(columnNames).not.toEqual(
      expect.arrayContaining(['token', 'secret', 'acceptance_url', 'invitation_url']),
    );

    const checks = await client.$queryRaw<Array<{ definition: string }>>`
      SELECT pg_get_constraintdef(constraint_row.oid) AS definition
      FROM pg_constraint AS constraint_row
      WHERE constraint_row.conrelid = 'invitations'::regclass
        AND constraint_row.contype = 'c'
    `;
    expect(checks).toHaveLength(4);
    expect(checks.map(({ definition }) => definition).join(' ')).toMatch(
      /expires_at.*issued_at.*invited_email_normalized.*token_hash.*status/isu,
    );

    const foreignKeys = await client.$queryRaw<
      Array<{ delete_action: string; referenced_table: string }>
    >`
      SELECT
        constraint_row.confdeltype::text AS delete_action,
        constraint_row.confrelid::regclass::text AS referenced_table
      FROM pg_constraint AS constraint_row
      WHERE constraint_row.conrelid = 'invitations'::regclass
        AND constraint_row.contype = 'f'
    `;
    expect(foreignKeys).toHaveLength(5);
    expect(foreignKeys.every(({ delete_action }) => delete_action === 'r')).toBe(true);
    expect(foreignKeys.map(({ referenced_table }) => referenced_table).sort()).toEqual([
      'employees',
      'employees',
      'employees',
      'organizations',
      'user_accounts',
    ]);

    const indexes = await client.$queryRaw<Array<{ indexname: string }>>`
      SELECT indexname FROM pg_indexes
      WHERE schemaname = 'public' AND tablename = 'invitations'
    `;
    const indexNames = indexes.map(({ indexname }) => indexname);
    expect(indexNames).toEqual(
      expect.arrayContaining([
        'invitations_token_hash_key',
        'invitations_organization_status_created_at_idx',
        'invitations_status_expires_at_idx',
        'invitations_organization_expires_at_idx',
      ]),
    );
  });

  it('issues the INVITED employee, ineligible account, invitation, audit, and outbox atomically', async () => {
    const issued = await issue();
    expect(issued.response.headers['cache-control']).toBe('no-store');
    expect(issued.response.body.data.acceptanceUrl).toMatch(/^\/onboarding#invite=[A-Za-z0-9_-]{43}$/u);
    expect(issued.response.body.data.invitation).not.toHaveProperty('tokenHash');
    expect(issued.response.body.data.invitation).not.toHaveProperty('acceptanceUrl');

    const invitation = await client.invitation.findUniqueOrThrow({ where: { id: issued.invitation.id } });
    const employee = await client.employee.findUniqueOrThrow({ where: { id: issued.invitation.employeeId } });
    const account = await client.userAccount.findUniqueOrThrow({ where: { id: issued.invitation.userAccountId } });
    expect(invitation.organizationId).toBe(actorA.organizationId);
    expect(invitation.invitedEmailNormalized).toBe('new.employee@example.com');
    expect(invitation.tokenHash).toMatch(/^[0-9a-f]{64}$/u);
    expect(invitation.tokenHash).not.toContain(issued.secret);
    expect(employee.lifecycleStatus).toBe('INVITED');
    expect(account.authenticationEligible).toBe(false);
    expect(invitation.expiresAt.getTime() - invitation.issuedAt.getTime()).toBe(300_000);

    const persisted = JSON.stringify({
      audits: await client.auditEvent.findMany(),
      security: await client.securityEvent.findMany(),
      outbox: await client.outboxEvent.findMany(),
    });
    expect(persisted).not.toContain(issued.secret);
    expect(persisted).not.toContain('new.employee@example.com');
    expect(logOutput).not.toContain(issued.secret);
    expect(logOutput).not.toContain('new.employee@example.com');
    expect(await client.outboxEvent.findMany({ select: { eventType: true } })).toEqual([
      { eventType: 'identity.employee-invited' },
    ]);
  });

  it('fails closed without an actor or authorization and never trusts caller organization scope', async () => {
    allowed = false;
    await request(app.getHttpServer())
      .post('/api/v1/employees/invite')
      .send({
        employeeCode: 'DENIED',
        firstName: 'Denied',
        lastName: 'Employee',
        displayName: 'Denied Employee',
        workEmail: 'denied@example.com',
      })
      .expect(403);
    currentActor = null;
    await request(app.getHttpServer()).get('/api/v1/invitations').expect(401);
    currentActor = actorA;
    allowed = true;
    await request(app.getHttpServer())
      .post('/api/v1/employees/invite')
      .send({
        organizationId: organizationBId,
        employeeCode: 'BAD-SCOPE',
        firstName: 'Bad',
        lastName: 'Scope',
        displayName: 'Bad Scope',
        workEmail: 'bad.scope@example.com',
      })
      .expect(400);
    expect(await client.invitation.count()).toBe(0);
  });

  it('lists only the actor organization and never serializes a secret', async () => {
    const issued = await issue();
    currentActor = actorB;
    const otherOrganization = await request(app.getHttpServer())
      .get('/api/v1/invitations')
      .expect(200);
    expect(otherOrganization.body.data.items).toEqual([]);
    currentActor = actorA;
    const own = await request(app.getHttpServer()).get('/api/v1/invitations').expect(200);
    expect(own.body.data.items).toHaveLength(1);
    expect(JSON.stringify(own.body)).not.toContain(issued.secret);
    expect(JSON.stringify(own.body)).not.toMatch(/tokenHash|acceptanceUrl/iu);
  });

  it('revokes only within organization scope and repeated revocation emits no duplicate event', async () => {
    const issued = await issue();
    currentActor = actorB;
    await request(app.getHttpServer())
      .post(`/api/v1/invitations/${issued.invitation.id}/revoke`)
      .send({})
      .expect(404);
    currentActor = actorA;
    await request(app.getHttpServer())
      .post(`/api/v1/invitations/${issued.invitation.id}/revoke`)
      .send({ reason: 'Recipient no longer requires access' })
      .expect(200);
    await request(app.getHttpServer())
      .post(`/api/v1/invitations/${issued.invitation.id}/revoke`)
      .send({})
      .expect(200);
    const invitation = await client.invitation.findUniqueOrThrow({ where: { id: issued.invitation.id } });
    expect(invitation).toMatchObject({
      status: 'REVOKED',
      revokedByEmployeeId: actorA.employeeId,
      safeRevocationReason: 'Recipient no longer requires access',
    });
    expect(
      await client.outboxEvent.count({ where: { eventType: 'identity.invitation-revoked' } }),
    ).toBe(1);
  });

  it('denies directly at the exact expiry boundary and materializes expiry once', async () => {
    const issued = await issue();
    const stored = await client.invitation.findUniqueOrThrow({ where: { id: issued.invitation.id } });
    now = stored.expiresAt;
    const inspected = await request(app.getHttpServer())
      .post('/api/v1/onboarding/invitation/inspect')
      .send({ invitationToken: issued.secret })
      .expect(200);
    expect(inspected.body.data.status).toBe('EXPIRED');
    expect(inspected.headers['referrer-policy']).toBe('no-referrer');
    await request(app.getHttpServer())
      .post('/api/v1/onboarding/invitation/inspect')
      .send({ invitationToken: issued.secret })
      .expect(200);
    expect((await client.invitation.findUniqueOrThrow({ where: { id: issued.invitation.id } })).status).toBe('EXPIRED');
    expect(
      await client.outboxEvent.count({ where: { eventType: 'identity.invitation-expired' } }),
    ).toBe(1);
  });

  it('uses a generic unknown-token error while safely reporting matched terminal states', async () => {
    const revoked = await issue('STATE-REVOKED');
    const accepted = await issue('STATE-ACCEPTED');
    await repository.revoke({ actor: actorA, invitationId: revoked.invitation.id, now });
    await repository.accept({
      authorizationReference: accepted.invitation.id,
      organizationId: organizationAId,
      identity: verifiedIdentity,
      now,
    });
    const unknown = await request(app.getHttpServer())
      .post('/api/v1/onboarding/invitation/inspect')
      .send({ invitationToken: 'A'.repeat(43) })
      .expect(401);
    expect(unknown.body.error).toMatchObject({
      code: 'INVITATION_INVALID',
      message: 'Invitation could not be validated',
    });
    const revokedInspection = await request(app.getHttpServer())
      .post('/api/v1/onboarding/invitation/inspect')
      .send({ invitationToken: revoked.secret })
      .expect(200);
    const acceptedInspection = await request(app.getHttpServer())
      .post('/api/v1/onboarding/invitation/inspect')
      .send({ invitationToken: accepted.secret })
      .expect(200);
    expect(revokedInspection.body.data.status).toBe('REVOKED');
    expect(acceptedInspection.body.data.status).toBe('ALREADY_USED');
    expect(JSON.stringify(unknown.body)).not.toContain('new.employee@example.com');
  });

  it('denies organization and unverified-identity mismatches before activation', async () => {
    const issued = await issue();
    const wrongOrganization = await repository.accept({
      authorizationReference: issued.invitation.id,
      organizationId: organizationBId,
      identity: verifiedIdentity,
      now,
    });
    const unverified = await repository.accept({
      authorizationReference: issued.invitation.id,
      organizationId: organizationAId,
      identity: {
        ...verifiedIdentity,
        verifiedEmail: 'new.employee@example.com',
        emailVerificationStatus: 'unverified',
      },
      now,
    });
    expect(wrongOrganization).toMatchObject({
      status: 'denied',
      failureCategory: 'organization_mismatch',
    });
    expect(unverified).toMatchObject({ status: 'denied', failureCategory: 'identity_mismatch' });
    expect((await client.invitation.findUniqueOrThrow({ where: { id: issued.invitation.id } })).status).toBe('PENDING');
    expect(await client.sSOIdentity.count()).toBe(0);
  });

  it('completes verified-email onboarding atomically and creates no application session', async () => {
    const issued = await issue();
    const started = await request(app.getHttpServer())
      .post('/api/v1/onboarding/auth/local/start')
      .send({ invitationToken: issued.secret, redirectUri, loginHint: 'invited' })
      .expect(200);
    const providerRedirect = new URL(started.body.data.authorizationUrl as string);
    expect(providerRedirect.href).not.toContain(issued.secret);
    const callback = await request(app.getHttpServer())
      .post('/api/v1/onboarding/auth/local/callback')
      .send({
        transactionId: providerRedirect.searchParams.get('transactionId'),
        state: providerRedirect.searchParams.get('state'),
        nonce: providerRedirect.searchParams.get('nonce'),
        code: providerRedirect.searchParams.get('code'),
      })
      .expect(200);
    expect(callback.body.data).toEqual({
      status: 'ONBOARDING_COMPLETED',
      providerKey: 'local',
      sessionCreated: false,
      nextStep: 'SESSION_ISSUANCE_DEFERRED',
    });
    expect(callback.headers['set-cookie']).toBeUndefined();
    expect(callback.headers.authorization).toBeUndefined();
    expect(await client.invitation.findUniqueOrThrow({ where: { id: issued.invitation.id } })).toMatchObject({
      status: 'ACCEPTED',
      acceptedAt: now,
      onboardingCompletedAt: now,
    });
    expect(await client.employee.findUniqueOrThrow({ where: { id: issued.invitation.employeeId } })).toMatchObject({
      lifecycleStatus: 'ACTIVE',
      activatedAt: now,
    });
    expect(await client.userAccount.findUniqueOrThrow({ where: { id: issued.invitation.userAccountId } })).toMatchObject({
      authenticationEligible: true,
      activatedAt: now,
    });
    expect(await client.sSOIdentity.findMany()).toHaveLength(1);
    expect(
      (await client.outboxEvent.findMany({ orderBy: { createdAt: 'asc' } })).map(({ eventType }) => eventType),
    ).toEqual([
      'identity.employee-invited',
      'identity.invitation-accepted',
      'identity.sso-identity-linked',
      'identity.onboarding-completed',
    ]);
  });

  it.each(['mismatched', 'missing-email'])(
    'denies %s provider email without changing invited account state',
    async (loginHint) => {
      const issued = await issue();
      const started = await request(app.getHttpServer())
        .post('/api/v1/onboarding/auth/local/start')
        .send({ invitationToken: issued.secret, redirectUri, loginHint })
        .expect(200);
      const providerRedirect = new URL(started.body.data.authorizationUrl as string);
      await request(app.getHttpServer())
        .post('/api/v1/onboarding/auth/local/callback')
        .send({
          transactionId: providerRedirect.searchParams.get('transactionId'),
          state: providerRedirect.searchParams.get('state'),
          nonce: providerRedirect.searchParams.get('nonce'),
          code: providerRedirect.searchParams.get('code'),
        })
        .expect(401);
      expect((await client.invitation.findUniqueOrThrow({ where: { id: issued.invitation.id } })).status).toBe('PENDING');
      expect((await client.employee.findUniqueOrThrow({ where: { id: issued.invitation.employeeId } })).lifecycleStatus).toBe('INVITED');
      expect(await client.sSOIdentity.count()).toBe(0);
    },
  );

  it('allows exactly one PostgreSQL acceptance under concurrent requests', async () => {
    const issued = await issue();
    const results = await Promise.all([
      repository.accept({
        authorizationReference: issued.invitation.id,
        organizationId: organizationAId,
        identity: verifiedIdentity,
        now,
      }),
      repository.accept({
        authorizationReference: issued.invitation.id,
        organizationId: organizationAId,
        identity: verifiedIdentity,
        now,
      }),
    ]);
    expect(results.filter(({ status }) => status === 'accepted')).toHaveLength(1);
    expect(results.filter(({ status }) => status === 'denied')).toHaveLength(1);
    expect(await client.sSOIdentity.count()).toBe(1);
    expect(
      await client.outboxEvent.count({ where: { eventType: 'identity.invitation-accepted' } }),
    ).toBe(1);
  });

  it('serializes accept versus revoke to one terminal result', async () => {
    const issued = await issue();
    await Promise.all([
      repository.accept({
        authorizationReference: issued.invitation.id,
        organizationId: organizationAId,
        identity: verifiedIdentity,
        now,
      }),
      repository.revoke({
        actor: actorA,
        invitationId: issued.invitation.id,
        now,
      }),
    ]);
    const invitation = await client.invitation.findUniqueOrThrow({ where: { id: issued.invitation.id } });
    expect(['ACCEPTED', 'REVOKED']).toContain(invitation.status);
    const terminalEvents = await client.outboxEvent.count({
      where: { eventType: { in: ['identity.invitation-accepted', 'identity.invitation-revoked'] } },
    });
    expect(terminalEvents).toBe(1);
    const employee = await client.employee.findUniqueOrThrow({ where: { id: issued.invitation.employeeId } });
    expect(employee.lifecycleStatus).toBe(invitation.status === 'ACCEPTED' ? 'ACTIVE' : 'INVITED');
  });

  it('denies acceptance deterministically when acceptance races the exact expiry boundary', async () => {
    const issued = await issue();
    const invitation = await client.invitation.findUniqueOrThrow({
      where: { id: issued.invitation.id },
    });
    const boundary = invitation.expiresAt;
    const [acceptance] = await Promise.all([
      repository.accept({
        authorizationReference: issued.invitation.id,
        organizationId: organizationAId,
        identity: verifiedIdentity,
        now: boundary,
      }),
      repository.materializeExpired({ invitationId: issued.invitation.id, now: boundary }),
    ]);
    expect(acceptance.status).toBe('denied');
    expect((await client.invitation.findUniqueOrThrow({ where: { id: issued.invitation.id } })).status).toBe('EXPIRED');
    expect(await client.sSOIdentity.count()).toBe(0);
    expect(
      await client.outboxEvent.count({ where: { eventType: 'identity.invitation-expired' } }),
    ).toBe(1);
  });

  it('rejects invitation substitution during callback and preserves the original bound transaction', async () => {
    const first = await issue('BOUND-A');
    const second = await issue('BOUND-B');
    const started = await request(app.getHttpServer())
      .post('/api/v1/onboarding/auth/local/start')
      .send({ invitationToken: first.secret, redirectUri, loginHint: 'invited' })
      .expect(200);
    const providerRedirect = new URL(started.body.data.authorizationUrl as string);
    const callbackBody = {
      transactionId: providerRedirect.searchParams.get('transactionId'),
      state: providerRedirect.searchParams.get('state'),
      nonce: providerRedirect.searchParams.get('nonce'),
      code: providerRedirect.searchParams.get('code'),
    };
    await request(app.getHttpServer())
      .post('/api/v1/onboarding/auth/local/callback')
      .send({ ...callbackBody, invitationToken: second.secret })
      .expect(401);
    expect((await client.invitation.findUniqueOrThrow({ where: { id: first.invitation.id } })).status).toBe('PENDING');
    expect((await client.invitation.findUniqueOrThrow({ where: { id: second.invitation.id } })).status).toBe('PENDING');
    await request(app.getHttpServer())
      .post('/api/v1/onboarding/auth/local/callback')
      .send(callbackBody)
      .expect(200);
    expect((await client.invitation.findUniqueOrThrow({ where: { id: first.invitation.id } })).status).toBe('ACCEPTED');
    expect((await client.invitation.findUniqueOrThrow({ where: { id: second.invitation.id } })).status).toBe('PENDING');
  });

  it('rolls back invitation, identity, account, employee, audit, and outbox state on required audit failure', async () => {
    const issued = await issue();
    const security = app.get<SecurityEventAppendPort>(SECURITY_EVENT_APPEND_PORT);
    const failingAudit: AuditEventAppendPort = {
      append: () => Promise.reject(new Error('forced audit failure')),
    };
    const failingRepository = new PrismaInvitationRepository(
      client,
      failingAudit,
      security,
      contextStore,
      logger,
    );
    await expect(
      failingRepository.accept({
        authorizationReference: issued.invitation.id,
        organizationId: organizationAId,
        identity: verifiedIdentity,
        now,
      }),
    ).rejects.toThrow('forced audit failure');
    expect((await client.invitation.findUniqueOrThrow({ where: { id: issued.invitation.id } })).status).toBe('PENDING');
    expect((await client.employee.findUniqueOrThrow({ where: { id: issued.invitation.employeeId } })).lifecycleStatus).toBe('INVITED');
    expect((await client.userAccount.findUniqueOrThrow({ where: { id: issued.invitation.userAccountId } })).authenticationEligible).toBe(false);
    expect(await client.sSOIdentity.count()).toBe(0);
    expect(
      await client.outboxEvent.count({ where: { eventType: 'identity.invitation-accepted' } }),
    ).toBe(0);
  });

  it('rolls back every mandatory stage when database failures are forced', async () => {
    const stages = [
      {
        name: 'sso',
        table: 'sso_identities',
        operation: 'INSERT',
        condition: "NEW.provider_key = 'local'",
      },
      {
        name: 'account',
        table: 'user_accounts',
        operation: 'UPDATE',
        condition: 'NEW.authentication_eligible = true',
      },
      {
        name: 'employee',
        table: 'employees',
        operation: 'UPDATE',
        condition: "NEW.lifecycle_status = 'ACTIVE'",
      },
      {
        name: 'outbox',
        table: 'outbox_events',
        operation: 'INSERT',
        condition: "NEW.event_type = 'identity.invitation-accepted'",
      },
    ] as const;

    for (const stage of stages) {
      await clearData(client);
      await createActors(client);
      const issued = await issue(`FAIL-${stage.name.toUpperCase()}`);
      const functionName = `t02_force_${stage.name}_failure`;
      const triggerName = `t02_force_${stage.name}_failure_trigger`;
      await client.$executeRawUnsafe(`
        CREATE OR REPLACE FUNCTION "${functionName}"() RETURNS trigger AS $$
        BEGIN RAISE EXCEPTION 'forced ${stage.name} failure'; END;
        $$ LANGUAGE plpgsql;
        CREATE TRIGGER "${triggerName}" BEFORE ${stage.operation} ON "${stage.table}"
        FOR EACH ROW WHEN (${stage.condition}) EXECUTE FUNCTION "${functionName}"();
      `);
      try {
        await expect(
          repository.accept({
            authorizationReference: issued.invitation.id,
            organizationId: organizationAId,
            identity: verifiedIdentity,
            now,
          }),
        ).rejects.toThrow();
      } finally {
        await client.$executeRawUnsafe(`DROP TRIGGER IF EXISTS "${triggerName}" ON "${stage.table}"`);
        await client.$executeRawUnsafe(`DROP FUNCTION IF EXISTS "${functionName}"()`);
      }
      expect((await client.invitation.findUniqueOrThrow({ where: { id: issued.invitation.id } })).status).toBe('PENDING');
      expect((await client.employee.findUniqueOrThrow({ where: { id: issued.invitation.employeeId } })).lifecycleStatus).toBe('INVITED');
      expect((await client.userAccount.findUniqueOrThrow({ where: { id: issued.invitation.userAccountId } })).authenticationEligible).toBe(false);
      expect(await client.sSOIdentity.count()).toBe(0);
      expect(
        await client.outboxEvent.count({ where: { eventType: 'identity.invitation-accepted' } }),
      ).toBe(0);
    }
  });

  it('documents only body-based invitation secrets and exposes no signup/password/customer path', async () => {
    const openApiResponse = await request(app.getHttpServer()).get('/api/v1/openapi.json').expect(200);
    const document = openApiResponse.body.data ?? openApiResponse.body;
    const paths = Object.keys(document.paths);
    expect(paths).toContain('/api/v1/employees/invite');
    expect(paths).toContain('/api/v1/onboarding/invitation/inspect');
    expect(paths.some((path) => /(?:token|invite).*[{:]/iu.test(path))).toBe(false);
    expect(JSON.stringify(document)).not.toMatch(/"example"\s*:\s*"[^"]*(?:invite|token)/i);
    const issueOperation = document.paths['/api/v1/employees/invite'].post;
    expect(JSON.stringify(issueOperation)).toMatch(/one-time/iu);
    for (const path of ['/api/v1/register', '/api/v1/signup', '/api/v1/customers/onboarding']) {
      await request(app.getHttpServer()).post(path).send({ password: 'irrelevant' }).expect(404);
    }
  });
});
