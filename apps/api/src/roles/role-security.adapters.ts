import { Inject, Injectable } from '@nestjs/common';
import { STRUCTURED_LOGGER, type StructuredLogger } from '@dar-tech/observability';
import type {
  RoleActor,
  RoleActorPort,
  RoleAuthorizationPort,
  RoleMetricsPort,
} from './role.contracts.js';

@Injectable()
export class DenyAllRoleActorAdapter implements RoleActorPort {
  currentActor(): Promise<RoleActor | null> {
    return Promise.resolve(null);
  }
}

@Injectable()
export class DenyAllRoleAuthorizationAdapter implements RoleAuthorizationPort {
  authorize(_request: Parameters<RoleAuthorizationPort['authorize']>[0]): Promise<boolean> {
    return Promise.resolve(false);
  }
}

@Injectable()
export class StructuredRoleMetricsAdapter implements RoleMetricsPort {
  constructor(@Inject(STRUCTURED_LOGGER) private readonly logger: StructuredLogger) {}

  record(input: Parameters<RoleMetricsPort['record']>[0]): void {
    this.logger.info('identity.role.metric', input);
  }
}
