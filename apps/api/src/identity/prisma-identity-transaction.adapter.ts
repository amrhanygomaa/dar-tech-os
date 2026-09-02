import { Inject, Injectable } from '@nestjs/common';
import {
  DATABASE_CLIENT,
  runInTransaction,
  type DatabaseClient,
  type DatabaseTransaction,
} from '@dar-tech/database';
import type { IdentityTransactionPort } from './identity.contracts.js';

@Injectable()
export class PrismaIdentityTransactionAdapter implements IdentityTransactionPort {
  constructor(@Inject(DATABASE_CLIENT) private readonly client: DatabaseClient) {}

  run<T>(work: (transaction: DatabaseTransaction) => Promise<T>): Promise<T> {
    return runInTransaction(this.client, work);
  }
}
