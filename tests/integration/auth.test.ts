import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createAuth, type Auth } from '@/server/auth/config';
import { MAGIC_LINK_PER_EMAIL, sharedRateLimitStorage } from '@/server/auth/rate-limit';
import type { DatabaseHandle } from '@/server/db/client';
import { authSessions, users } from '@/server/db/schema';
import { seedReferenceData } from '@/server/db/seed/reference-data';
import { ensureSuperAdmin } from '@/server/db/seed/super-admin';
import type { EmailMessage } from '@/server/email/email';
import { createTestDatabase } from '../helpers/db';

const BASE = 'http://localhost:3000';
const LINK_PATTERN = /http:\/\/localhost:3000\/api\/auth\/magic-link\/verify\S+/;

let handle: DatabaseHandle;
let auth: Auth;
const outbox: EmailMessage[] = [];

beforeAll(async () => {
  handle = await createTestDatabase();
  await seedReferenceData(handle.db);
  auth = createAuth({
    db: handle.db,
    baseURL: BASE,
    secret: process.env.BETTER_AUTH_SECRET!,
    trustedOrigins: [BASE],
    sendEmail: async (message) => void outbox.push(message),
  });
});

afterAll(async () => {
  await handle.close();
});

async function requestLink(email: string): Promise<{ status: number; link?: string }> {
  const sentBefore = outbox.length;
  const response = await auth.handler(
    new Request(`${BASE}/api/auth/sign-in/magic-link`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', origin: BASE },
      body: JSON.stringify({ email, callbackURL: '/app' }),
    }),
  );
  const message = outbox.slice(sentBefore).find((m) => m.to === email);
  return { status: response.status, link: message?.text.match(LINK_PATTERN)?.[0] };
}

const hasSessionCookie = (response: Response) =>
  response.headers.getSetCookie().some((c) => /session_token=[^;]+/.test(c));

describe('portal sign-in with magic links (Better Auth)', () => {
  it('signs an invited user in once, activates the account and starts without 2FA verification', async () => {
    const { userId } = await ensureSuperAdmin(handle.db, { email: 'owner@gentouch.test', firstName: 'Ministry', lastName: 'Owner' });

    const { status, link } = await requestLink('owner@gentouch.test');
    expect(status).toBe(200);
    expect(link).toBeDefined();

    const verify = await auth.handler(new Request(link!));
    expect(verify.status).toBeGreaterThanOrEqual(300);
    expect(verify.status).toBeLessThan(400);
    expect(verify.headers.get('location')).toMatch(/\/app$/);
    expect(hasSessionCookie(verify)).toBe(true);

    const [user] = await handle.db.select().from(users).where(eq(users.id, userId));
    expect(user).toMatchObject({ status: 'active' });
    expect(user!.lastLoginAt).not.toBeNull();

    const sessions = await handle.db.select().from(authSessions).where(eq(authSessions.userId, userId));
    expect(sessions).toHaveLength(1);
    expect(sessions[0]!.twoFactorVerifiedAt).toBeNull();

    // Single use.
    const reuse = await auth.handler(new Request(link!));
    expect(hasSessionCookie(reuse)).toBe(false);
  });

  it('never creates an account for an unknown email (invitation only)', async () => {
    const { link } = await requestLink('stranger@example.org');
    if (link) {
      const verify = await auth.handler(new Request(link));
      expect(hasSessionCookie(verify)).toBe(false);
    }
    const found = await handle.db.select().from(users).where(eq(users.email, 'stranger@example.org'));
    expect(found).toHaveLength(0);
  });

  it('lets a room full of leaders on one connection sign in (docs/07 M5.6)', async () => {
    // Every request here shares one address, as a church Wi-Fi or a carrier's subscribers do.
    // Better Auth's own default of 5 a minute refused the sixth; the raised limit is 30.
    const statuses: number[] = [];
    for (let i = 0; i < 12; i++) statuses.push((await requestLink(`leader-${i}@gentouch.test`)).status);
    expect(statuses.filter((s) => s === 429)).toEqual([]);
  });

  it('stops one inbox being flooded, for a real address and an unknown one alike', async () => {
    const seen: number[] = [];
    for (let i = 0; i < MAGIC_LINK_PER_EMAIL.limit + 1; i++) seen.push((await requestLink('flooded@gentouch.test')).status);

    expect(seen.slice(0, MAGIC_LINK_PER_EMAIL.limit)).not.toContain(429);
    expect(seen.at(-1)).toBe(429);

    // An address with no account is counted and answered identically, so 429 tells an attacker
    // nothing about who has an account.
    const unknown: number[] = [];
    for (let i = 0; i < MAGIC_LINK_PER_EMAIL.limit + 1; i++) unknown.push((await requestLink('nobody@example.org')).status);
    expect(unknown.at(-1)).toBe(429);
  });

  it('counts sign-in attempts in the shared store, so every instance sees the same total', async () => {
    // What Better Auth calls for its per-IP counters. Two instances would call the same store.
    const storage = sharedRateLimitStorage(handle.db);
    const key = `test-${Date.now()}`;
    expect(await storage.consume(key, { window: 60, max: 2 })).toEqual({ allowed: true, retryAfter: null });
    expect(await storage.consume(key, { window: 60, max: 2 })).toEqual({ allowed: true, retryAfter: null });

    const blocked = await storage.consume(key, { window: 60, max: 2 });
    expect(blocked.allowed).toBe(false);
    expect(blocked.retryAfter).toBeGreaterThan(0);
  });

  it('refuses to sign in a deactivated account', async () => {
    const { userId } = await ensureSuperAdmin(handle.db, { email: 'former@gentouch.test', firstName: 'Former', lastName: 'Admin' });
    await handle.db.update(users).set({ status: 'deactivated' }).where(eq(users.id, userId));

    const { link } = await requestLink('former@gentouch.test');
    if (link) {
      const verify = await auth.handler(new Request(link));
      expect(hasSessionCookie(verify)).toBe(false);
    }
    const sessions = await handle.db.select().from(authSessions).where(eq(authSessions.userId, userId));
    expect(sessions).toHaveLength(0);
  });
});
