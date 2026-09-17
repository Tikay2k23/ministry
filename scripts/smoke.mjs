/**
 * `npm run smoke -- https://your-app.example.org` — checks a deployed app from the outside.
 *
 * Part of the deployment runbook (docs/runbooks/deployment.md): run it straight after a deploy,
 * before telling anyone the address. It signs in to nothing and reads no one's data; it only asks
 * whether the public surface answers correctly and carries its security headers.
 *
 * Exit code 0 means every check passed; 1 means at least one failed.
 */

const base = (process.argv[2] ?? '').replace(/\/$/, '');
if (!base.startsWith('http')) {
  console.error('Usage: npm run smoke -- https://your-app.example.org');
  process.exit(2);
}
const https = base.startsWith('https://');

const checks = [];
const check = (name, ok, detail = '') => checks.push({ name, ok, detail });

const get = (path, options = {}) =>
  fetch(`${base}${path}`, { redirect: 'manual', headers: { 'user-agent': 'gentouch-smoke' }, ...options });

const securityHeaders = (response, path) => {
  const h = response.headers;
  const policy = h.get('content-security-policy') ?? '';
  const nonce = /'nonce-([^']+)'/.exec(policy)?.[1];
  check(`${path} · Content-Security-Policy with a nonce`, Boolean(nonce) && policy.includes("'strict-dynamic'"), policy.slice(0, 60));
  check(`${path} · no unsafe-inline scripts`, !/script-src[^;]*'unsafe-inline'/.test(policy));
  // `next dev` needs 'unsafe-eval' for hot reloading, so only a real deployment is held to this.
  if (https) check(`${path} · no unsafe-eval scripts`, !/script-src[^;]*'unsafe-eval'/.test(policy));
  check(`${path} · X-Content-Type-Options`, h.get('x-content-type-options') === 'nosniff');
  check(`${path} · X-Frame-Options`, h.get('x-frame-options') === 'DENY');
  check(`${path} · Referrer-Policy`, h.get('referrer-policy') === 'strict-origin-when-cross-origin');
  check(`${path} · no X-Powered-By`, h.get('x-powered-by') === null);
  if (https) check(`${path} · Strict-Transport-Security`, (h.get('strict-transport-security') ?? '').includes('max-age='));
  return nonce;
};

try {
  // 1. The app can serve and reach its database.
  const health = await get('/api/health');
  const healthBody = await health.json().catch(() => ({}));
  check('/api/health is ok', health.status === 200 && healthBody.status === 'ok', `${health.status} ${JSON.stringify(healthBody)}`);

  // 2. The pages people actually open, each with a fresh nonce.
  const nonces = new Set();
  for (const path of ['/sign-in', '/j', '/privacy']) {
    const response = await get(path);
    check(`${path} answers`, response.status === 200, `status ${response.status}`);
    const nonce = securityHeaders(response, path);
    if (nonce) nonces.add(nonce);
    if (response.status === 200) {
      const html = await response.text();
      const scripts = html.match(/<script\b[^>]*>/g) ?? [];
      check(`${path} · every script carries this response's nonce`, scripts.length > 0 && scripts.every((tag) => tag.includes(`nonce="${nonce}"`)));
    }
  }
  check('each page gets its own nonce', nonces.size === 3, `${nonces.size} distinct`);

  // 3. The portal is closed to strangers.
  const portal = await get('/app');
  check('/app sends a stranger to sign in', [302, 303, 307, 308].includes(portal.status) && (portal.headers.get('location') ?? '').includes('/sign-in'), `status ${portal.status}`);

  // 4. Personal links never leak their token onward, and are never cached.
  const token = await get('/a/not-a-real-token-0000000000000000000');
  check('/a/{token} sends no referrer', token.headers.get('referrer-policy') === 'no-referrer');
  const cacheControl = token.headers.get('cache-control') ?? '';
  check('/a/{token} is not cached', https ? cacheControl.includes('no-store') : /no-store|no-cache/.test(cacheControl), cacheControl);

  // 5. The background-job endpoint refuses callers without the secret.
  const cron = await get('/api/cron/tick');
  check('/api/cron/tick refuses an unauthenticated call', [401, 404].includes(cron.status), `status ${cron.status}`);

  // 6. Cross-site posts are refused (CSRF).
  const crossSite = await get('/api/public/serving/respond', {
    method: 'POST',
    headers: { 'content-type': 'application/json', origin: 'https://attacker.example' },
    body: JSON.stringify({ token: 'not-a-real-token', response: 'accept' }),
  });
  check('a post from another site is refused', crossSite.status === 403, `status ${crossSite.status}`);

  // 7. Search engines are kept off the pages with people's data.
  const robots = await get('/robots.txt');
  const robotsText = robots.status === 200 ? await robots.text() : '';
  // The app disallows everything; accept either that or the portal and token pages by name.
  const keepsCrawlersOut = /Disallow:\s*\/\s*$/m.test(robotsText) || (/Disallow:\s*\/app/.test(robotsText) && /Disallow:\s*\/a\//.test(robotsText));
  check('robots.txt keeps search engines out', keepsCrawlersOut, robotsText.replace(/\s+/g, ' ').slice(0, 60));
} catch (error) {
  check('the app answered at all', false, String(error));
}

for (const { name, ok, detail } of checks) console.log(`${ok ? '✓' : '✗'} ${name}${detail && !ok ? ` — ${detail}` : ''}`);
const failed = checks.filter((c) => !c.ok);
console.log(`\n${checks.length - failed.length}/${checks.length} checks passed against ${base}`);
if (failed.length > 0) {
  console.error(`${failed.length} failed. Do not hand the address out yet.`);
  process.exitCode = 1;
}
