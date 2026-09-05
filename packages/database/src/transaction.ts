import type { Prisma } from './generated/prisma/client.js';
import type { DatabaseClient } from './client.js';

export type DatabaseTransaction = Prisma.TransactionClient;

export type TransactionWork<T> = (transaction: DatabaseTransaction) => Promise<T>;

export function runInTransaction<T>(
  client: DatabaseClient,
  work: TransactionWork<T>,
): Promise<T> {
  return client.$transaction(work, {
    isolationLevel: 'ReadCommitted',
    maxWait: 5_000,
    timeout: 10_000,
  });
}
