import { expect, test } from '@playwright/test';
import { E2E_ADMIN_EMAIL, E2E_LEADER, E2E_MEMBER, E2E_PASTOR } from './support/e2e-env';
import { signIn } from './support/sign-in';

test('an administrator signs in with a magic link and finds people and the leadership structure', async ({ page }) => {
  await signIn(page, E2E_ADMIN_EMAIL);

  const nav = page.getByRole('navigation', { name: 'Main' });

  await nav.getByRole('link', { name: 'People' }).click();
  await expect(page.getByRole('heading', { name: 'People' })).toBeVisible();
  const member = page.getByRole('link', { name: `${E2E_MEMBER.firstName} ${E2E_MEMBER.lastName}` });
  await expect(member).toBeVisible();
  await expect(page.getByRole('row', { name: new RegExp(E2E_MEMBER.firstName) })).toContainText(E2E_LEADER.firstName);

  await member.click();
  await expect(page.getByRole('heading', { name: new RegExp(`${E2E_MEMBER.firstName} ${E2E_MEMBER.lastName}`) })).toBeVisible();

  await nav.getByRole('link', { name: 'Leadership' }).click();
  await expect(page.getByText(`${E2E_PASTOR.firstName} ${E2E_PASTOR.lastName}`).first()).toBeVisible();

  await nav.getByRole('link', { name: 'Daily Journal' }).click();
  await expect(page).toHaveURL(/\/app\/journal/);
});
