import { type DynamicModule, Global, Module } from "@nestjs/common";
import type { TemporaryAccessConfig } from "@dar-tech/config";
import {
  TEMPORARY_ACCESS_CONFIG,
  TEMPORARY_ACCESS_REPOSITORY,
} from "./temporary-access.contracts.js";
import { TemporaryAccessController } from "./temporary-access.controller.js";
import { TemporaryAccessMetrics } from "./temporary-access-metrics.js";
import { PrismaTemporaryAccessRepository } from "./prisma-temporary-access.repository.js";
import { TemporaryAccessService } from "./temporary-access.service.js";
import { AUTHORIZATION_TEMPORARY_GRANT_LOOKUP } from "../authorization/authorization.contracts.js";
import { PrismaAuthorizationTemporaryGrantSource } from "./temporary-access-grant-source.js";

@Global()
@Module({})
export class TemporaryAccessModule {
  static register(config: TemporaryAccessConfig): DynamicModule {
    return {
      module: TemporaryAccessModule,
      controllers: [TemporaryAccessController],
      providers: [
        { provide: TEMPORARY_ACCESS_CONFIG, useValue: config },
        PrismaTemporaryAccessRepository,
        PrismaAuthorizationTemporaryGrantSource,
        {
          provide: AUTHORIZATION_TEMPORARY_GRANT_LOOKUP,
          useExisting: PrismaAuthorizationTemporaryGrantSource,
        },
        {
          provide: TEMPORARY_ACCESS_REPOSITORY,
          useExisting: PrismaTemporaryAccessRepository,
        },
        TemporaryAccessMetrics,
        TemporaryAccessService,
      ],
      exports: [
        TEMPORARY_ACCESS_REPOSITORY,
        AUTHORIZATION_TEMPORARY_GRANT_LOOKUP,
        TemporaryAccessService,
      ],
    };
  }
}
