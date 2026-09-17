import { expect, type Page } from '@playwright/test';
import { firstLink, waitForEmail } from './outbox';

/**
 * Sign-in is rate limited two ways (src/server/auth/rate-limit.ts): 30 requests a minute per IP
 * address for each of `/sign-in/magic-link` and `/magic-link/verify` — all tests share 127.0.0.1 —
 * and 10 per quarter of an hour per email address, which spans several test runs. Rather than time
 * out 20 seconds later on a missing "Check your email", say so plainly: the fix is fewer sign-ins
 * per run (support/fixtures.ts), or waiting, not a longer timeout.
 */
const RATE_LIMITED =
  'This sign-in was rate limited (30 a minute per IP, 10 per 15 minutes per address). ' +
  'Use the shared admin session from tests/e2e/support/fixtures.ts unless the test is about signing in, ' +
  'and give the address a few minutes if the suite has run repeatedly.';

/** Signs in with a magic link from the test outbox and waits for the dashboard. */
export async function signIn(page: Page, email: string): Promise<void> {
  const requestedAt = new Date(Date.now() - 1_000);
  await page.goto('/sign-in');
  await page.getByLabel('Email address').fill(email);
  await page.getByRole('button', { name: 'Email me a sign-in link' }).click();

  const sent = page.getByText('Check your email');
  const limited = page.getByText(/Too many attempts|already sent several sign-in links/);
  await expect(sent.or(limited)).toBeVisible();
  if (await limited.isVisible()) throw new Error(RATE_LIMITED);

  const message = await waitForEmail(email, requestedAt);
  const response = await page.goto(firstLink(message.text));
  if (response?.status() === 429) throw new Error(RATE_LIMITED);
  await expect(page).toHaveURL(/\/app$/);
}
