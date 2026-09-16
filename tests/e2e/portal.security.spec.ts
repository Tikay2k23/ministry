import { expect, test, type APIResponse } from '@playwright/test';
import { E2E_ADMIN_EMAIL } from './support/e2e-env';
import { signIn } from './support/sign-in';

/**
 * Security checks on the running app (docs/02 §8, docs/07 §7 "Security"): headers, the per-request
 * script nonce, personal-link pages, cross-site posts, markup in people's text and session cookies.
 * Also run against a production build in CI (E2E_SERVER_MODE=production), where signing in isn't
 * possible and those tests are skipped.
 */

const production = process.env.E2E_SERVER_MODE === 'production';
const PUBLIC_PAGES = ['/sign-in', '/j', '/privacy'];

function nonceOf(response: APIResponse): string {
  const policy = response.headers()['content-security-policy'] ?? '';
  const nonce = /'nonce-([^']+)'/.exec(policy)?.[1];
  expect(nonce, 'a nonce in the Content-Security-Policy').toBeTruthy();
  return nonce!;
}

test('pages send a strict Content-Security-Policy with a fresh nonce, and the other security headers', async ({ request }) => {
  const nonces = new Set<string>();
  for (const path of PUBLIC_PAGES) {
    const response = await request.get(path);
    expect(response.status(), path).toBeLessThan(400);
    const headers = response.headers();
    const policy = headers['content-security-policy']!;
    const scriptSrc = policy.split('; ').find((d) => d.startsWith('script-src '))!;

    expect(scriptSrc, path).toContain("'strict-dynamic'");
    expect(scriptSrc, path).not.toContain("'unsafe-inline'");
    if (production) expect(scriptSrc, path).not.toContain("'unsafe-eval'");
    for (const directive of ["frame-ancestors 'none'", "object-src 'none'", "base-uri 'self'", "form-action 'self'"]) {
      expect(policy, path).toContain(directive);
    }
    expect(headers['x-content-type-options']).toBe('nosniff');
    expect(headers['x-frame-options']).toBe('DENY');
    expect(headers['referrer-policy']).toBe('strict-origin-when-cross-origin');
    expect(headers['permissions-policy']).toContain('camera=()');
    expect(headers['cross-origin-opener-policy']).toBe('same-origin');
    expect(headers['x-powered-by']).toBeUndefined();
    if (production) expect(headers['strict-transport-security']).toContain('max-age=');

    // Every script on the page carries this response's nonce; anything else would be blocked.
    const nonce = nonceOf(response);
    nonces.add(nonce);
    const scripts = (await response.text()).match(/<script\b[^>]*>/g) ?? [];
    expect(scripts.length, path).toBeGreaterThan(0);
    for (const tag of scripts) expect(tag, path).toContain(`nonce="${nonce}"`);
  }
  expect(nonces.size).toBe(PUBLIC_PAGES.length);
});

test('personal-link pages never leak their token as a referrer, and are not cached', async ({ request }) => {
  for (const path of ['/a/not-a-real-token-0000000000000000000', '/k/not-a-real-token-0000000000000000000']) {
    const response = await request.get(path);
    expect(response.headers()['referrer-policy'], path).toBe('no-referrer');
    expect(response.headers()['cache-control'], path).toMatch(production ? /no-store/ : /no-store|no-cache/);
  }
});

test('public forms refuse posts from other sites (CSRF)', async ({ request }) => {
  const body = { token: 'not-a-real-token', response: 'accept' };
  const crossSite = await request.post('/api/public/serving/respond', { data: body, headers: { Origin: 'https://attacker.example' } });
  expect(crossSite.status()).toBe(403);
  expect((await crossSite.json()).error.code).toBe('FORBIDDEN');

  // A post that doesn't say where it comes from is refused too.
  const noOrigin = await request.post('/api/public/serving/respond', { data: body });
  expect(noOrigin.status()).toBe(403);
});

test('the portal runs without policy violations, shows markup in names as text, and keeps session cookies HttpOnly', async ({ page, context }) => {
  test.skip(production, 'Signing in needs the test email outbox, which a production build does not use.');
  test.setTimeout(240_000);

  const violations: string[] = [];
  page.on('console', (message) => {
    if (/Content Security Policy|Refused to (execute|load|apply)/i.test(message.text())) violations.push(message.text());
  });
  let dialogs = 0;
  page.on('dialog', (dialog) => {
    dialogs += 1;
    void dialog.dismiss();
  });

  await page.goto('/j');
  await signIn(page, E2E_ADMIN_EMAIL);

  const cookies = await context.cookies();
  const session = cookies.find((cookie) => cookie.name.endsWith('session_token'));
  expect(session, 'a session cookie').toBeTruthy();
  expect(session!.httpOnly).toBe(true);
  expect(session!.sameSite).toBe('Lax');

  // Someone types markup into a name: it must appear as plain text and never run.
  const payload = '<img src=x onerror="window.__xss=1">';
  await page.goto('/app/people/new');
  await page.getByLabel('First name').fill(payload);
  await page.getByLabel('Last name').fill('<script>window.__xss=2</script>');
  await page.getByRole('button', { name: 'Add person' }).click();
  await expect(page).toHaveURL(/\/app\/people\/[0-9a-f-]{36}$/);
  await expect(page.getByRole('heading', { level: 1 })).toContainText(payload);
  await page.goto(`/app/people?q=${encodeURIComponent('window.__xss')}`);
  await expect(page.getByText(payload).first()).toBeVisible();
  expect(await page.evaluate(() => (window as unknown as { __xss?: number }).__xss)).toBeUndefined();

  for (const path of ['/app', '/app/devotional', '/app/prayer', '/app/journal', '/app/reports', '/app/ministries']) {
    await page.goto(path);
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
  }
  expect(dialogs).toBe(0);
  expect(violations).toEqual([]);
});
