import 'dotenv/config';
import { createPrismaClient } from '../packages/database/src/client.js';

const databaseUrl = process.env.DATABASE_URL;

if (!databaseUrl) {
  throw new Error('DATABASE_URL is required for the explicit seed command.');
}

const client = createPrismaClient({ databaseUrl, errorFormat: 'minimal' });

try {
  await client.$queryRaw`SELECT 1`;
  process.stdout.write('Sprint 01 seed complete; no reference data is required.\n');
} finally {
  await client.$disconnect();
}
