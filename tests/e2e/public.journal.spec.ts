import { expect, test } from '@playwright/test';
import { E2E_LEADER, E2E_MEMBER } from './support/e2e-env';

/** Public forms turn away anything sent within two seconds of the page loading (bot protection). */
const HUMAN_PAUSE_MS = 2_500;

test('a member finds themselves by mobile number and sends today’s journal', async ({ page }) => {
  await page.goto('/j');
  await page.getByRole('button', { name: 'I’ve journaled before' }).click();

  await page.getByLabel('Mobile number').fill(E2E_MEMBER.phone);
  await page.getByLabel('First name').fill(E2E_MEMBER.firstName);
  await page.waitForTimeout(HUMAN_PAUSE_MS);
  await page.getByRole('button', { name: 'Continue' }).click();

  await expect(page.getByRole('heading', { name: `Hello, ${E2E_MEMBER.firstName}!` })).toBeVisible();
  await expect(page.getByText(new RegExp(`Leader: ${E2E_LEADER.firstName}`))).toBeVisible();

  await page.getByLabel(/What is God speaking to you through it\?/).fill('He is teaching me to trust Him with my family.');
  await page.getByRole('group', { name: /Did you spend time in prayer today\?/ }).getByRole('radio', { name: 'Yes' }).check();
  await page.waitForTimeout(HUMAN_PAUSE_MS);
  await page.getByRole('button', { name: 'Send my journal' }).click();

  await expect(page.getByRole('heading', { name: `Thank you, ${E2E_MEMBER.firstName}!` })).toBeVisible();
  await page.getByRole('button', { name: 'Back to my journal' }).click();
  await expect(page.getByText('Journal received')).toBeVisible();
});
