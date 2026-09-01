import 'dotenv/config';
import { defineConfig } from 'prisma/config';

const fallbackValidationUrl =
  'postgresql://validation:validation@127.0.0.1:5432/dartech_validation?schema=public';
const shadowDatabaseUrl = process.env.SHADOW_DATABASE_URL;

export default defineConfig({
  schema: 'prisma/schema.prisma',
  migrations: {
    path: 'prisma/migrations',
    seed: 'tsx prisma/seed.ts',
  },
  datasource: {
    url: process.env.MIGRATION_DATABASE_URL ?? process.env.DATABASE_URL ?? fallbackValidationUrl,
    ...(shadowDatabaseUrl ? { shadowDatabaseUrl } : {}),
  },
});
