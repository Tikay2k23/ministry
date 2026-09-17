import { test } from '@playwright/test';
import { expectNoAccessibilityViolations } from './support/axe';

/** Accessibility on the public, login-free pages (docs/07 §7), on a phone (playwright.config.ts). */

test('the public pages have no WCAG 2.2 AA violations', async ({ page }) => {
  for (const [path, label] of [
    ['/sign-in', 'Sign in'],
    ['/j', 'Daily Journal'],
    ['/privacy', 'Privacy notice'],
  ] as const) {
    await page.goto(path);
    await expectNoAccessibilityViolations(page, label);
  }
});
