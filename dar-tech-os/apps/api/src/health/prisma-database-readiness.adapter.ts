import { Inject, Injectable } from '@nestjs/common';
import {
  DATABASE_CLIENT,
  checkDatabaseHealth,
  type DatabaseClient,
  type DatabaseHealthResult,
} from '@dar-tech/database';
import type { DatabaseReadinessPort } from './database-readiness.port.js';

@Injectable()
export class PrismaDatabaseReadinessAdapter implements DatabaseReadinessPort {
  constructor(@Inject(DATABASE_CLIENT) private readonly client: DatabaseClient) {}

  check(): Promise<DatabaseHealthResult> {
    return checkDatabaseHealth(this.client);
  }
}
