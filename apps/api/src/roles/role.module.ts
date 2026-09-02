import { type DynamicModule, Module, type Provider } from '@nestjs/common';
import type { AppEnvironment } from '@dar-tech/config';
import {
  ROLE_ACTOR_PORT,
  ROLE_AUTHORIZATION_PORT,
  ROLE_CLOCK,
  ROLE_METRICS_PORT,
  ROLE_REPOSITORY_PORT,
  type RoleActorPort,
  type RoleAuthorizationPort,
  type RoleClock,
  type RoleMetricsPort,
  type RoleRepositoryPort,
} from './role.contracts.js';
import { EmployeeRolesController, RolesController } from './role.controller.js';
import { PrismaRoleRepository } from './prisma-role.repository.js';
import {
  DenyAllRoleActorAdapter,
  DenyAllRoleAuthorizationAdapter,
  StructuredRoleMetricsAdapter,
} from './role-security.adapters.js';
import { RoleService } from './role.service.js';

export interface RoleTestAdapters {
  readonly actors?: RoleActorPort;
  readonly authorization?: RoleAuthorizationPort;
  readonly clock?: RoleClock;
  readonly metrics?: RoleMetricsPort;
  readonly repository?: RoleRepositoryPort;
}

function selectedProvider(token: symbol, value: object | undefined, fallback: Provider): Provider {
  return value ? { provide: token, useValue: value } : fallback;
}

@Module({})
export class RoleModule {
  static register(environment: AppEnvironment, testAdapters?: RoleTestAdapters): DynamicModule {
    if (testAdapters && environment !== 'test') {
      throw new Error('Role test adapters are available only in the test environment');
    }
    return {
      module: RoleModule,
      controllers: [RolesController, EmployeeRolesController],
      providers: [
        selectedProvider(ROLE_ACTOR_PORT, testAdapters?.actors, {
          provide: ROLE_ACTOR_PORT,
          useClass: DenyAllRoleActorAdapter,
        }),
        selectedProvider(ROLE_AUTHORIZATION_PORT, testAdapters?.authorization, {
          provide: ROLE_AUTHORIZATION_PORT,
          useClass: DenyAllRoleAuthorizationAdapter,
        }),
        selectedProvider(ROLE_CLOCK, testAdapters?.clock, {
          provide: ROLE_CLOCK,
          useValue: { now: () => new Date() },
        }),
        selectedProvider(ROLE_METRICS_PORT, testAdapters?.metrics, {
          provide: ROLE_METRICS_PORT,
          useClass: StructuredRoleMetricsAdapter,
        }),
        PrismaRoleRepository,
        selectedProvider(ROLE_REPOSITORY_PORT, testAdapters?.repository, {
          provide: ROLE_REPOSITORY_PORT,
          useExisting: PrismaRoleRepository,
        }),
        RoleService,
      ],
      exports: [ROLE_REPOSITORY_PORT, RoleService, PrismaRoleRepository],
    };
  }
}
