import { expect, type Page } from '@playwright/test';
import { firstLink, waitForEmail } from './outbox';

/** Signs in with a magic link from the test outbox and waits for the dashboard. */
export async function signIn(page: Page, email: string): Promise<void> {
  const requestedAt = new Date(Date.now() - 1_000);
  await page.goto('/sign-in');
  await page.getByLabel('Email address').fill(email);
  await page.getByRole('button', { name: 'Email me a sign-in link' }).click();
  await expect(page.getByText('Check your email')).toBeVisible();

  const message = await waitForEmail(email, requestedAt);
  await page.goto(firstLink(message.text));
  await expect(page).toHaveURL(/\/app$/);
}
