import { expectNoAccessibilityViolations } from './support/axe';
import { expect, test } from './support/fixtures';

/**
 * Automated accessibility (docs/07 §7): axe-core (WCAG 2.2 AA) on the main portal pages and a
 * form, a skip link that reaches the content, and no sideways panning of the whole page at 200%
 * zoom (a 640 CSS-px viewport, roughly what 200% zoom leaves on a 1280-wide screen). The manual
 * screen-reader pass (TalkBack, VoiceOver) is docs/accessibility-checklist.md.
 */

const PAGES: [string, string][] = [
  ['/app', 'Dashboard'],
  ['/app/people', 'People'],
  ['/app/leadership', 'Leadership'],
  ['/app/journal', 'Daily Journal'],
  ['/app/prayer', 'Prayer Chain'],
  ['/app/devotional', 'Devotional calendar'],
  ['/app/devotional/teams', 'Worship teams'],
  ['/app/devotional/setup', 'Devotional setup'],
  ['/app/ministries', 'Ministries'],
  ['/app/reports', 'Reports'],
  ['/app/notifications', 'Notifications'],
  ['/app/admin/users', 'Users & Permissions'],
  ['/app/admin/settings', 'Settings'],
  ['/app/admin/health', 'System health'],
  ['/app/admin/qr', 'QR codes'],
  ['/app/admin/qr/general?layout=poster', 'Daily Journal poster'],
];

test('the main portal pages have no WCAG 2.2 AA violations', async ({ page }) => {
  test.setTimeout(240_000);
  for (const [path, label] of PAGES) {
    await page.goto(path);
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
    await expectNoAccessibilityViolations(page, label);
  }
});

test('a form (Add a person) has no violations, and its errors are announced', async ({ page }) => {
  await page.goto('/app/people/new');
  await expectNoAccessibilityViolations(page, 'Add a person');

  // Submitting empty fails validation, and the message is exposed as an alert, not only as colour.
  await page.getByRole('button', { name: 'Add person' }).click();
  await expect(page.getByRole('alert').first()).toBeVisible();
  // The submit button disables for a moment while validation runs, and its colour transition
  // (Tailwind's 150ms) can still be mid-way when the errors appear; scan once it has settled.
  await page.waitForTimeout(300);
  await expectNoAccessibilityViolations(page, 'Add a person, with validation errors shown');
});

test('a skip link lets keyboard users reach the content without tabbing through the sidebar', async ({ page }) => {
  await page.goto('/app/people');
  await page.keyboard.press('Tab');
  await expect(page.getByRole('link', { name: 'Skip to content' })).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(page.locator('#main-content')).toBeFocused();
});

test('key pages don’t let the whole page pan sideways at 200% zoom', async ({ page }) => {
  test.setTimeout(120_000);
  await page.setViewportSize({ width: 640, height: 800 });
  for (const [path, label] of [['/app', 'Dashboard'], ['/app/people', 'People'], ['/app/admin/settings', 'Settings']] as const) {
    await page.goto(path, { waitUntil: 'networkidle' });
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
    // A wide table that scrolls inside its own container (People) still makes Chromium report the
    // document wider than the viewport, so `scrollWidth` can't tell a pinned page from a panning
    // one. A real sideways wheel gesture can: the page must not move (html/body overflow-x hidden
    // in src/app/globals.css), while the table keeps its own scrolling.
    await page.mouse.move(320, 400);
    await page.mouse.wheel(500, 0);
    await page.waitForTimeout(100);
    expect(await page.evaluate(() => window.scrollX), label).toBe(0);
  }
});
