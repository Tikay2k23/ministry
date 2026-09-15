/**
 * The end-to-end test server (playwright.config.ts → webServer). It seeds a fresh embedded
 * database, then runs `next dev` on port 3100 with its own build output (.next-e2e) and email
 * outbox, so it can run beside `npm run dev` without touching your development data.
 */
import { spawn } from 'node:child_process';
import { rm } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { E2E_BASE_URL, E2E_DATA_DIR, E2E_OUTBOX_DIR, E2E_PORT } from './support/e2e-env';

const databaseUrl = `pglite://./${E2E_DATA_DIR}/pglite`;

// Set before anything reads the environment. Next.js never overrides variables that already exist,
// so these win over the values in your .env file.
Object.assign(process.env, {
  APP_URL: E2E_BASE_URL,
  BETTER_AUTH_URL: E2E_BASE_URL,
  BETTER_AUTH_SECRET: 'e2e-only-secret-not-used-anywhere-else-0000',
  APP_ENCRYPTION_KEY: 'e2e-only-encryption-key-not-used-elsewhere-00',
  DATABASE_URL: databaseUrl,
  DATABASE_URL_MIGRATOR: databaseUrl,
  EMAIL_PROVIDER: 'file',
  EMAIL_OUTBOX_DIR: E2E_OUTBOX_DIR,
  RATE_LIMIT_STORE: 'postgres',
  SCHEDULER_MODE: 'off',
  SENTRY_DSN: '',
  NEXT_PUBLIC_SENTRY_DSN: '',
  NEXT_DIST_DIR: '.next-e2e',
  NEXT_TELEMETRY_DISABLED: '1',
});

await rm(E2E_DATA_DIR, { recursive: true, force: true });
const { seedE2eData } = await import('./seed');
await seedE2eData(databaseUrl);

const nextBin = createRequire(import.meta.url).resolve('next/dist/bin/next');
const server = spawn(process.execPath, [nextBin, 'dev', '--port', String(E2E_PORT)], { stdio: 'inherit', env: process.env });

const stop = () => server.kill();
process.on('SIGINT', stop);
process.on('SIGTERM', stop);
server.on('exit', (code) => process.exit(code ?? 0));
