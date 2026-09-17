import { devices } from '@playwright/test';
import { E2E_BASE_URL, E2E_MEMBER } from './support/e2e-env';
import { expect, test } from './support/fixtures';

const TEAM_NAME = 'Team A';
const memberName = `${E2E_MEMBER.firstName} ${E2E_MEMBER.lastName}`;

/** A date in the ministry's time zone. Two days ahead, a 6:00 AM gathering is always 1–3 days away. */
const ministryDate = (daysAhead: number) => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Manila' }).format(Date.now() + daysAhead * 86_400_000);

test('a coordinator builds a worship team and a roster, and a member says yes with their personal link', async ({ page, browser }) => {
  // The first visits compile several portal and public pages on the dev server.
  test.setTimeout(240_000);
  await page.goto('/app');

  // A worship team whose one member usually leads worship.
  await page.getByRole('navigation', { name: 'Main' }).getByRole('link', { name: 'Devotional' }).click();
  await expect(page.getByRole('heading', { name: 'Devotional', exact: true })).toBeVisible();
  await page.getByRole('link', { name: 'Worship teams' }).click();
  await page.getByRole('button', { name: 'New worship team' }).click();
  await page.getByLabel('Team name').fill(TEAM_NAME);
  await page.getByRole('button', { name: 'Add team' }).click();
  await expect(page.getByRole('heading', { name: TEAM_NAME })).toBeVisible();

  await page.getByRole('button', { name: 'Add member' }).click();
  const addMember = page.getByRole('dialog', { name: `Add someone to ${TEAM_NAME}` });
  await addMember.getByRole('searchbox', { name: 'Search people' }).fill(E2E_MEMBER.firstName);
  await addMember.getByRole('button', { name: new RegExp(memberName) }).click();
  await expect(addMember).toBeHidden();

  await page.getByRole('button', { name: `Actions for ${memberName}` }).click();
  await page.getByRole('menuitem', { name: 'Roles they play' }).click();
  const roles = page.getByRole('dialog', { name: `${memberName}’s roles` });
  await roles.getByRole('checkbox', { name: 'Worship Leader' }).click();
  await roles.getByRole('button', { name: 'Save roles' }).click();
  await expect(roles).toBeHidden();
  await expect(page.getByRole('listitem').filter({ hasText: memberName })).toContainText('Worship Leader (main role)');

  // A one-off Morning Devotional, filled from the team.
  await page.getByRole('link', { name: 'Setup' }).click();
  await page.getByRole('link', { name: 'Morning Devotional' }).click();
  await expect(page.getByRole('heading', { name: 'Morning Devotional', exact: true })).toBeVisible();
  await page.getByLabel('Date', { exact: true }).fill(ministryDate(2));
  await page.getByRole('combobox', { name: 'Team (fills the roster)' }).selectOption({ label: TEAM_NAME });
  await page.getByRole('button', { name: 'Create gathering' }).click();

  // The roster is a draft with the member as Worship Leader. It's published with the other roles still open.
  await expect(page).toHaveURL(/\/app\/devotional\/[0-9a-f-]{36}$/);
  await expect(page.getByText('Draft', { exact: true })).toBeVisible();
  await expect(page.getByText(memberName)).toBeVisible();
  await page.getByRole('button', { name: 'Publish roster' }).click();
  const openRoles = page.getByRole('dialog', { name: 'Some roles are still open' });
  await openRoles.getByRole('button', { name: 'Publish anyway' }).click();
  await expect(openRoles).toBeHidden();
  await expect(page.getByText('Published', { exact: true })).toBeVisible();

  // The coordinator shares the member's personal link.
  await page.getByRole('button', { name: `Actions for ${memberName}` }).click();
  await page.getByRole('menuitem', { name: 'Share their link' }).click();
  const share = page.getByRole('dialog', { name: `Share ${memberName}’s link` });
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
    await expect(mobile.getByText('Worship Leader', { exact: true }).first()).toBeVisible();
    await mobile.getByRole('button', { name: 'I’ll be there' }).click();
    await expect(mobile.getByText('You’re serving — thank you!')).toBeVisible();
  } finally {
    await phone.close();
  }

  // The roster and the dashboard show the reply.
  await page.reload();
  await expect(page.getByRole('region', { name: 'Roster' }).getByText('Confirmed', { exact: true })).toBeVisible();
  await page.getByRole('navigation', { name: 'Main' }).getByRole('link', { name: 'Dashboard' }).click();
  const devotional = page.getByRole('region', { name: 'Devotional' });
  await expect(devotional.getByRole('link', { name: 'Morning Devotional' })).toBeVisible();
  await expect(devotional).toContainText('1 confirmed');
});
