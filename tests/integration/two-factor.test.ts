import { randomUUID } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { Secret, TOTP } from 'otpauth';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { DatabaseHandle } from '@/server/db/client';
import { authSessions, users, userTwoFactors } from '@/server/db/schema';
import { confirmTotpSetup, startTotpSetup, verifySecondFactor } from '@/server/modules/iam/two-factor.service';
import { createTestDatabase } from '../helpers/db';
import { createUser, userContext } from '../helpers/fixtures';

let handle: DatabaseHandle;

beforeAll(async () => {
  handle = await createTestDatabase();
});

afterAll(async () => {
  await handle.close();
});

async function userWithSession() {
  const user = await createUser(handle.db);
  const [session] = await handle.db
    .insert(authSessions)
    .values({ userId: user.id, token: randomUUID(), expiresAt: new Date(Date.now() + 86_400_000) })
    .returning();
  return { user, sessionId: session!.id };
}

const codeAt = (manualKey: string, at: Date) =>
  new TOTP({ secret: Secret.fromBase32(manualKey.replaceAll(' ', '')), digits: 6, period: 30 }).generate({
    timestamp: at.getTime(),
  });

describe('two-factor authentication (TOTP)', () => {
  it('enrols with a valid code, stores the secret encrypted and verifies the session', async () => {
    const { user, sessionId } = await userWithSession();
    const now = new Date('2026-09-12T08:00:00Z');
    const ctx = userContext(user, [], now);

    const setup = await startTotpSetup(handle.db, { id: user.id, email: user.email });
    expect(setup.otpauthUri).toMatch(/^otpauth:\/\/totp\/GenTouch/);
    expect(setup.qrSvg).toContain('<svg');

    const [stored] = await handle.db.select().from(userTwoFactors).where(eq(userTwoFactors.userId, user.id));
    expect(stored!.secretEncrypted).not.toContain(setup.manualKey.replaceAll(' ', ''));

    const { backupCodes } = await confirmTotpSetup(handle.db, ctx, { userId: user.id, sessionId, code: codeAt(setup.manualKey, now) });
    expect(backupCodes).toHaveLength(10);

    const [updatedUser] = await handle.db.select().from(users).where(eq(users.id, user.id));
    expect(updatedUser!.twoFactorEnabled).toBe(true);
    const [session] = await handle.db.select().from(authSessions).where(eq(authSessions.id, sessionId));
    expect(session!.twoFactorVerifiedAt).not.toBeNull();
  });

  it('rejects a wrong code during enrolment', async () => {
    const { user, sessionId } = await userWithSession();
    await startTotpSetup(handle.db, { id: user.id, email: user.email });
    await expect(
      confirmTotpSetup(handle.db, userContext(user, []), { userId: user.id, sessionId, code: '000000' }),
    ).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
  });

  it('refuses to replay a code, accepts the next one, and accepts backup codes once', async () => {
    const { user, sessionId } = await userWithSession();
    const t0 = new Date('2026-09-12T09:00:00Z');
    const setup = await startTotpSetup(handle.db, { id: user.id, email: user.email });
    const { backupCodes } = await confirmTotpSetup(handle.db, userContext(user, [], t0), {
      userId: user.id,
      sessionId,
      code: codeAt(setup.manualKey, t0),
    });

    // Same code, same time window → replay rejected.
    await expect(
      verifySecondFactor(handle.db, userContext(user, [], t0), { userId: user.id, sessionId, code: codeAt(setup.manualKey, t0) }),
    ).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });

    const t1 = new Date(t0.getTime() + 60_000);
    await expect(
      verifySecondFactor(handle.db, userContext(user, [], t1), { userId: user.id, sessionId, code: codeAt(setup.manualKey, t1) }),
    ).resolves.toMatchObject({ usedBackupCode: false });

    const backup = backupCodes[0]!;
    await expect(
      verifySecondFactor(handle.db, userContext(user, [], t1), { userId: user.id, sessionId, code: backup }),
    ).resolves.toMatchObject({ usedBackupCode: true, remainingBackupCodes: 9 });
    await expect(
      verifySecondFactor(handle.db, userContext(user, [], t1), { userId: user.id, sessionId, code: backup }),
    ).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
  });

  it('locks verification after five failed attempts', async () => {
    const { user, sessionId } = await userWithSession();
    const now = new Date('2026-09-12T10:00:00Z');
    const setup = await startTotpSetup(handle.db, { id: user.id, email: user.email });
    await confirmTotpSetup(handle.db, userContext(user, [], now), { userId: user.id, sessionId, code: codeAt(setup.manualKey, now) });

    for (let i = 0; i < 5; i++) {
      await expect(
        verifySecondFactor(handle.db, userContext(user, [], now), { userId: user.id, sessionId, code: '123456' }),
      ).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
    }
    const later = new Date(now.getTime() + 60_000);
    await expect(
      verifySecondFactor(handle.db, userContext(user, [], later), { userId: user.id, sessionId, code: codeAt(setup.manualKey, later) }),
    ).rejects.toMatchObject({ code: 'RATE_LIMITED' });
  });
});
