import { defineConfig, devices } from '@playwright/test';
import { E2E_BASE_URL } from './tests/e2e/support/e2e-env';

/**
 * End-to-end regression tests for the M1–M4 workflows (tests/e2e), run with `npm run test:e2e`.
 * The web server is a separate `next dev` on port 3100 with a fresh database (tests/e2e/server.ts).
 * Portal pages are tested on a desktop browser, the public pages on a phone.
 */
export default defineConfig({
  testDir: 'tests/e2e',
  fullyParallel: false,
  workers: 1,
  retries: process.env.CI ? 1 : 0,
  forbidOnly: Boolean(process.env.CI),
  timeout: 90_000,
  expect: { timeout: 20_000 },
  reporter: process.env.CI ? [['list'], ['html', { open: 'never' }]] : 'list',
  use: {
    baseURL: E2E_BASE_URL,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  projects: [
    { name: 'portal', testMatch: /portal\..*spec\.ts/, use: { ...devices['Desktop Chrome'] } },
    { name: 'public', testMatch: /public\..*spec\.ts/, use: { ...devices['Pixel 7'] } },
  ],
  webServer: {
    command: 'node --import tsx tests/e2e/server.ts',
    url: `${E2E_BASE_URL}/sign-in`,
    // In CI a fresh server is required, except where the job starts one itself (the security scan).
    reuseExistingServer: !process.env.CI || process.env.E2E_REUSE_SERVER === '1',
    timeout: 300_000,
    stdout: 'pipe',
  },
});
