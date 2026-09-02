import { type DynamicModule, Module, type Provider } from '@nestjs/common';
import type { AppEnvironment } from '@dar-tech/config';
import {
  AUTHENTICATED_ACTOR_PORT,
  IDENTITY_AUDIT_HOOK,
  IDENTITY_AUTHORIZATION_PORT,
  IDENTITY_REPOSITORY_PORT,
  IDENTITY_TRANSACTION_PORT,
  type AuthenticatedActorPort,
  type IdentityAuditHook,
  type IdentityAuthorizationPort,
} from './identity.contracts.js';
import { EmployeesController, MeController } from './identity.controller.js';
import {
  DenyAllAuthenticatedActorAdapter,
  DenyAllIdentityAuthorizationAdapter,
  DurableIdentityAuditHook,
} from './identity-security.adapters.js';
import { PrismaIdentityRepository } from './prisma-identity.repository.js';
import { PrismaIdentityTransactionAdapter } from './prisma-identity-transaction.adapter.js';
import { IdentityService } from './identity.service.js';

export interface IdentityTestAdapters {
  readonly actors?: AuthenticatedActorPort;
  readonly authorization?: IdentityAuthorizationPort;
  readonly audit?: IdentityAuditHook;
}

@Module({})
export class IdentityModule {
  static register(
    appEnvironment: AppEnvironment,
    testAdapters?: IdentityTestAdapters,
  ): DynamicModule {
    if (testAdapters && appEnvironment !== 'test') {
      throw new Error('Identity test adapters are available only in the test environment');
    }

    const actorProvider: Provider = testAdapters?.actors
      ? { provide: AUTHENTICATED_ACTOR_PORT, useValue: testAdapters.actors }
      : { provide: AUTHENTICATED_ACTOR_PORT, useClass: DenyAllAuthenticatedActorAdapter };
    const authorizationProvider: Provider = testAdapters?.authorization
      ? { provide: IDENTITY_AUTHORIZATION_PORT, useValue: testAdapters.authorization }
      : {
          provide: IDENTITY_AUTHORIZATION_PORT,
          useClass: DenyAllIdentityAuthorizationAdapter,
        };
    const auditProvider: Provider = testAdapters?.audit
      ? { provide: IDENTITY_AUDIT_HOOK, useValue: testAdapters.audit }
      : { provide: IDENTITY_AUDIT_HOOK, useClass: DurableIdentityAuditHook };

    return {
      module: IdentityModule,
      controllers: [MeController, EmployeesController],
      providers: [
        actorProvider,
        authorizationProvider,
        auditProvider,
        PrismaIdentityTransactionAdapter,
        {
          provide: IDENTITY_TRANSACTION_PORT,
          useExisting: PrismaIdentityTransactionAdapter,
        },
        PrismaIdentityRepository,
        { provide: IDENTITY_REPOSITORY_PORT, useExisting: PrismaIdentityRepository },
        IdentityService,
      ],
      exports: [IDENTITY_REPOSITORY_PORT, IdentityService, PrismaIdentityRepository],
    };
  }
}
