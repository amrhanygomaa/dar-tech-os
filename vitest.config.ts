import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['apps/**/*.spec.ts', 'packages/**/*.spec.ts'],
    exclude: ['**/*.integration.spec.ts', '**/node_modules/**', '**/dist/**'],
    passWithNoTests: false,
    restoreMocks: true,
  },
});
