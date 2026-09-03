import { Inject, Injectable } from "@nestjs/common";
import {
  STRUCTURED_LOGGER,
  type StructuredLogger,
} from "@dar-tech/observability";
import type {
  PermissionActor,
  PermissionActorPort,
  PermissionAdministrationAuthorizationPort,
  PermissionMetricsPort,
} from "./permission.contracts.js";

@Injectable()
export class DenyAllPermissionActorAdapter implements PermissionActorPort {
  currentActor(): Promise<PermissionActor | null> {
    return Promise.resolve(null);
  }
}

@Injectable()
export class DenyAllPermissionAdministrationAuthorizationAdapter implements PermissionAdministrationAuthorizationPort {
  allows(
    _request: Parameters<
      PermissionAdministrationAuthorizationPort["allows"]
    >[0],
  ): Promise<boolean> {
    return Promise.resolve(false);
  }
}

@Injectable()
export class StructuredPermissionMetricsAdapter implements PermissionMetricsPort {
  constructor(
    @Inject(STRUCTURED_LOGGER) private readonly logger: StructuredLogger,
  ) {}

  record(input: Parameters<PermissionMetricsPort["record"]>[0]): void {
    this.logger.info("identity.permission.metric", input);
  }
}
