import { expect, test } from '@playwright/test';
import sharp from 'sharp';
import { E2E_LEADER, E2E_MEMBER } from './support/e2e-env';

/** Public forms turn away anything sent within two seconds of the page loading (bot protection). */
const HUMAN_PAUSE_MS = 2_500;

/** A photograph of a written journal, the way a phone would send one. */
const photoOfAJournal = () =>
  sharp({ create: { width: 1400, height: 1900, channels: 3, background: { r: 245, g: 243, b: 232 } } })
    .jpeg()
    .toBuffer();

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

  // The ministry asks for a photo of the written journal. The file input is hidden behind the
  // camera and gallery buttons, so the test sets it the way the picker would.
  await expect(page.getByRole('heading', { name: 'Journal Proof' })).toBeVisible();
  await page.locator('input[type="file"]').first().setInputFiles({
    name: 'journal.jpg',
    mimeType: 'image/jpeg',
    buffer: await photoOfAJournal(),
  });
  await expect(page.getByText('Ready to submit')).toBeVisible();

  await page.waitForTimeout(HUMAN_PAUSE_MS);
  await page.getByRole('button', { name: 'Send my journal' }).click();

  await expect(page.getByRole('heading', { name: `Thank you, ${E2E_MEMBER.firstName}!` })).toBeVisible();
  await page.getByRole('button', { name: 'Back to my journal' }).click();
  // After the 09:00 late cutoff the page shows today's receipt. Before it, yesterday's journal is still open, so the
  // page moves on to yesterday and marks today's tab as received instead.
  await expect(page.getByText('Journal received').or(page.getByRole('tab', { name: 'Today received' })).first()).toBeVisible();
});
