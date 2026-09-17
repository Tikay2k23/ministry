import { devices } from '@playwright/test';
import { E2E_BASE_URL, E2E_MEMBER } from './support/e2e-env';
import { expect, test } from './support/fixtures';

/** Public forms turn away anything sent within two seconds of the page loading (bot protection). */
const HUMAN_PAUSE_MS = 2_500;
const CHAIN_NAME = 'Night Watch';
const memberName = `${E2E_MEMBER.firstName} ${E2E_MEMBER.lastName}`;

test('a coordinator starts a prayer chain and assigns a member, who confirms with their personal link', async ({ page, browser }) => {
  // The first visits compile several portal and public pages on the dev server.
  test.setTimeout(240_000);
  await page.goto('/app');

  // Create the chain with the default pattern (24 hourly slots a day) and start it.
  await page.getByRole('navigation', { name: 'Main' }).getByRole('link', { name: 'Prayer Chain' }).click();
  await expect(page.getByRole('heading', { name: 'Prayer Chain', exact: true })).toBeVisible();
  await page.getByRole('link', { name: 'New chain' }).click();
  await page.getByLabel('Name', { exact: true }).fill(CHAIN_NAME);
  await page.getByRole('button', { name: 'Create chain' }).click();

  await expect(page.getByRole('heading', { name: 'Schedule & setup' })).toBeVisible();
  await page.getByRole('button', { name: 'Start the chain' }).click();
  await expect(page.getByText(/The chain is running/)).toBeVisible();
  const publicUrl = await page.getByRole('link', { name: 'Open the public page' }).getAttribute('href');
  expect(publicUrl).toMatch(/\/pray\//);

  // Tomorrow's slots haven't started, so the member can still confirm theirs.
  await page.goto(page.url().replace(/\/setup$/, ''));
  await expect(page.getByRole('heading', { name: CHAIN_NAME, exact: true })).toBeVisible();
  await page.getByRole('link', { name: 'Next day' }).click();
  await expect(page).toHaveURL(/date=/);
  await page.getByRole('button', { name: 'Assign' }).first().click();
  const assign = page.getByRole('dialog', { name: 'Assign someone' });
  await assign.getByRole('searchbox', { name: 'Search people' }).fill(E2E_MEMBER.firstName);
  await assign.getByRole('button', { name: new RegExp(memberName) }).click();
  await expect(assign).toBeHidden();
  await expect(page.getByText('Upcoming', { exact: true })).toBeVisible();

  // The coordinator shares the member's personal link.
  await page.getByRole('button', { name: `Actions for ${memberName}` }).click();
  await page.getByRole('menuitem', { name: 'Share their link' }).click();
  const share = page.getByRole('dialog', { name: /Share .+ link/ });
  await share.getByRole('button', { name: 'Create their link' }).click();
  const messageBox = share.getByRole('textbox', { name: 'Message with their link' });
  await expect(messageBox).toHaveValue(/https?:\/\//);
  const personalLink = /https?:\/\/\S+/.exec(await messageBox.inputValue())![0];
  await page.keyboard.press('Escape');

  const phone = await browser.newContext({ ...devices['Pixel 7'], baseURL: E2E_BASE_URL });
  try {
    const mobile = await phone.newPage();
    await mobile.goto(personalLink);
    await expect(mobile.getByRole('heading', { name: `Hello, ${E2E_MEMBER.firstName}!` })).toBeVisible();
    await mobile.getByRole('button', { name: 'Confirm my slot' }).click();
    await expect(mobile.getByText('Confirmed — thank you!')).toBeVisible();

    // The chain's public page finds the same slot by mobile number and first name.
    await mobile.goto(publicUrl!);
    await expect(mobile.getByRole('heading', { name: CHAIN_NAME, exact: true })).toBeVisible();
    await mobile.getByRole('button', { name: 'Find my slot' }).click();
    await mobile.getByLabel('Mobile number').fill(E2E_MEMBER.phone);
    await mobile.getByLabel('First name').fill(E2E_MEMBER.firstName);
    await mobile.waitForTimeout(HUMAN_PAUSE_MS);
    await mobile.getByRole('button', { name: 'Continue' }).click();
    await expect(mobile.getByRole('heading', { name: `Hello, ${E2E_MEMBER.firstName}!` })).toBeVisible();
    await expect(mobile.getByText('Confirmed — thank you!')).toBeVisible();
  } finally {
    await phone.close();
  }

  // The board shows the confirmation.
  await page.reload();
  await expect(page.getByText('Confirmed', { exact: true })).toBeVisible();
});
