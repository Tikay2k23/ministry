import { test as base, type BrowserContext } from '@playwright/test';
import { E2E_ADMIN_EMAIL, E2E_BASE_URL } from './e2e-env';
import { signIn } from './sign-in';

type StorageState = Awaited<ReturnType<BrowserContext['storageState']>>;

/**
 * Portal tests that aren't about signing in start already signed in as the E2E admin, from one
 * sign-in per worker shared across spec files. Every test runs from 127.0.0.1, and Better Auth
 * lets one address request only five sign-in links before it needs a quiet minute (see
 * support/sign-in.ts), so a sign-in per test runs out partway through the suite.
 *
 * Tests of signing in itself (portal.people, and the cookie checks in portal.security) keep
 * calling `signIn` so they exercise the real flow.
 */
export const test = base.extend<object, { adminSession: StorageState }>({
  // Playwright's fixture callback is usually named `use`; `provide` keeps the React Hooks lint rule
  // from mistaking it for React's `use()`.
  adminSession: [
    async ({ browser }, provide) => {
      const context = await browser.newContext({ baseURL: E2E_BASE_URL });
      const page = await context.newPage();
      await signIn(page, E2E_ADMIN_EMAIL);
      const state = await context.storageState();
      await context.close();
      await provide(state);
    },
    // Its own timeout: the first sign-in of a run also waits for the dev server to compile pages.
    { scope: 'worker', timeout: 120_000 },
  ],
  storageState: async ({ adminSession }, provide) => {
    await provide(adminSession);
  },
});

export { expect } from '@playwright/test';
