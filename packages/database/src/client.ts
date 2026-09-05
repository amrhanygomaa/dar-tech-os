import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from './generated/prisma/client.js';

export interface DatabaseClientOptions {
  readonly databaseUrl: string;
  readonly poolMax?: number;
  readonly connectTimeoutMs?: number;
  readonly idleTimeoutMs?: number;
  readonly errorFormat?: 'minimal' | 'pretty';
}

export function createPrismaClient(options: DatabaseClientOptions): PrismaClient {
  const adapter = new PrismaPg({
    connectionString: options.databaseUrl,
    max: options.poolMax ?? 10,
    connectionTimeoutMillis: options.connectTimeoutMs ?? 5_000,
    idleTimeoutMillis: options.idleTimeoutMs ?? 30_000,
  });

  return new PrismaClient({
    adapter,
    errorFormat: options.errorFormat ?? 'minimal',
  });
}

export type DatabaseClient = PrismaClient;
