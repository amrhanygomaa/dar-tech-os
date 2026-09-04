import { type DynamicModule, Global, Module, type Provider } from "@nestjs/common";
import type { AppEnvironment } from "@dar-tech/config";
import {
  PERMISSION_ACTOR_PORT,
  PERMISSION_ADMINISTRATION_AUTHORIZATION_PORT,
  PERMISSION_CLOCK,
  PERMISSION_METRICS_PORT,
  PERMISSION_REPOSITORY_PORT,
  type PermissionActorPort,
  type PermissionAdministrationAuthorizationPort,
  type PermissionClock,
  type PermissionMetricsPort,
  type PermissionRepositoryPort,
} from "./permission.contracts.js";
import {
  PermissionsController,
  RolePermissionsController,
} from "./permission.controller.js";
import { PrismaPermissionRepository } from "./prisma-permission.repository.js";
import {
  StructuredPermissionMetricsAdapter,
} from "./permission-security.adapters.js";
import {
  CentralAuthenticatedActorAdapter,
  CentralPermissionAuthorizationAdapter,
} from "../authorization/authorization.adapters.js";
import {
  PermissionRegistryService,
  PermissionService,
} from "./permission.service.js";

export interface PermissionTestAdapters {
  readonly actors?: PermissionActorPort;
  readonly authorization?: PermissionAdministrationAuthorizationPort;
  readonly clock?: PermissionClock;
  readonly metrics?: PermissionMetricsPort;
  readonly repository?: PermissionRepositoryPort;
}

function selectedProvider(
  token: symbol,
  value: object | undefined,
  fallback: Provider,
): Provider {
  return value ? { provide: token, useValue: value } : fallback;
}

@Global()
@Module({})
export class PermissionModule {
  static register(
    environment: AppEnvironment,
    testAdapters?: PermissionTestAdapters,
  ): DynamicModule {
    if (testAdapters && environment !== "test") {
      throw new Error(
        "Permission test adapters are available only in the test environment",
      );
    }
    return {
      module: PermissionModule,
      controllers: [PermissionsController, RolePermissionsController],
      providers: [
        selectedProvider(PERMISSION_ACTOR_PORT, testAdapters?.actors, {
          provide: PERMISSION_ACTOR_PORT,
          useClass: CentralAuthenticatedActorAdapter,
        }),
        selectedProvider(
          PERMISSION_ADMINISTRATION_AUTHORIZATION_PORT,
          testAdapters?.authorization,
          {
            provide: PERMISSION_ADMINISTRATION_AUTHORIZATION_PORT,
            useClass: CentralPermissionAuthorizationAdapter,
          },
        ),
        selectedProvider(PERMISSION_CLOCK, testAdapters?.clock, {
          provide: PERMISSION_CLOCK,
          useValue: { now: () => new Date() },
        }),
        selectedProvider(PERMISSION_METRICS_PORT, testAdapters?.metrics, {
          provide: PERMISSION_METRICS_PORT,
          useClass: StructuredPermissionMetricsAdapter,
        }),
        PrismaPermissionRepository,
        selectedProvider(PERMISSION_REPOSITORY_PORT, testAdapters?.repository, {
          provide: PERMISSION_REPOSITORY_PORT,
          useExisting: PrismaPermissionRepository,
        }),
        PermissionService,
        PermissionRegistryService,
      ],
      exports: [
        PERMISSION_REPOSITORY_PORT,
        PrismaPermissionRepository,
        PermissionService,
        PermissionRegistryService,
      ],
    };
  }
}
