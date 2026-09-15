import path from 'node:path';
import { defineConfig } from 'vitest/config';

const root = import.meta.dirname;

export default defineConfig({
  resolve: {
    alias: {
      '@': path.resolve(root, 'src'),
      // `server-only` throws outside the React Server Components runtime; tests run in plain Node.
      'server-only': path.resolve(root, 'tests/helpers/server-only-stub.ts'),
    },
  },
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts'],
    setupFiles: ['tests/setup-env.ts'],
    // Each integration test file boots an in-memory PostgreSQL (PGlite) and applies all migrations.
    testTimeout: 30_000,
    hookTimeout: 120_000,
  },
});
