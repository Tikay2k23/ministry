import { expect, type Page } from '@playwright/test';
import { firstLink, waitForEmail } from './outbox';

/**
 * Better Auth's magic-link plugin (better-auth 1.7, plugins/magic-link) allows five requests from
 * one IP address to `/sign-in/magic-link`, and five to `/magic-link/verify`, before blocking; each
 * allowed request restarts a one-minute clock, so the count clears only after a quiet minute.
 * All tests share 127.0.0.1. Rather than time out 20 seconds later on a missing "Check your email",
 * say so plainly: the fix is fewer sign-ins per run (support/fixtures.ts), not a longer wait.
 */
const RATE_LIMITED =
  'Better Auth rate-limited this sign-in (5 magic-link requests per IP until a quiet minute). ' +
  'Use the shared admin session from tests/e2e/support/fixtures.ts unless the test is about signing in.';

/** Signs in with a magic link from the test outbox and waits for the dashboard. */
export async function signIn(page: Page, email: string): Promise<void> {
  const requestedAt = new Date(Date.now() - 1_000);
  await page.goto('/sign-in');
  await page.getByLabel('Email address').fill(email);
  await page.getByRole('button', { name: 'Email me a sign-in link' }).click();

  const sent = page.getByText('Check your email');
  const limited = page.getByText('Too many attempts');
  await expect(sent.or(limited)).toBeVisible();
  if (await limited.isVisible()) throw new Error(RATE_LIMITED);

  const message = await waitForEmail(email, requestedAt);
  const response = await page.goto(firstLink(message.text));
  if (response?.status() === 429) throw new Error(RATE_LIMITED);
  await expect(page).toHaveURL(/\/app$/);
}
