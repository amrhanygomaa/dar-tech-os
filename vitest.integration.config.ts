import { fileURLToPath, URL } from 'node:url';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  resolve: {
    alias: {
      '@dar-tech/config': fileURLToPath(new URL('./packages/config/src/index.ts', import.meta.url)),
      '@dar-tech/database': fileURLToPath(
        new URL('./packages/database/src/index.ts', import.meta.url),
      ),
      '@dar-tech/observability': fileURLToPath(
        new URL('./packages/observability/src/index.ts', import.meta.url),
      ),
      '@dar-tech/outbox': fileURLToPath(
        new URL('./packages/outbox/src/index.ts', import.meta.url),
      ),
      '@dar-tech/queue': fileURLToPath(
        new URL('./packages/queue/src/index.ts', import.meta.url),
      ),
      '@dar-tech/types': fileURLToPath(new URL('./packages/types/src/index.ts', import.meta.url)),
    },
  },
  test: {
    environment: 'node',
    include: ['packages/**/*.integration.spec.ts'],
    fileParallelism: false,
    maxWorkers: 1,
    minWorkers: 1,
    passWithNoTests: false,
    restoreMocks: true,
    sequence: {
      concurrent: false,
    },
    testTimeout: 30_000,
    hookTimeout: 30_000,
  },
});
