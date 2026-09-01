import { fileURLToPath, URL } from 'node:url';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  root: fileURLToPath(new URL('.', import.meta.url)),
  resolve: {
    alias: {
      '@dar-tech/config': fileURLToPath(
        new URL('../config/src/index.ts', import.meta.url),
      ),
      '@dar-tech/database': fileURLToPath(
        new URL('../database/src/index.ts', import.meta.url),
      ),
      '@dar-tech/observability': fileURLToPath(
        new URL('../observability/src/index.ts', import.meta.url),
      ),
      '@dar-tech/queue': fileURLToPath(
        new URL('./src/index.ts', import.meta.url),
      ),
      '@dar-tech/types': fileURLToPath(
        new URL('../types/src/index.ts', import.meta.url),
      ),
    },
  },
  test: {
    environment: 'node',
    include: ['src/**/*.integration.spec.ts'],
    fileParallelism: false,
    restoreMocks: true,
  },
});
