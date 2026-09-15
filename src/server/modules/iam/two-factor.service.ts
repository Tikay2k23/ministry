import { eq, sql } from 'drizzle-orm';
import { Secret, TOTP } from 'otpauth';
import QRCode from 'qrcode';
import { randomCode } from '@/lib/ids';
import type { RequestContext } from '../../context/request-context';
import type { Database, Executor } from '../../db/client';
import { authSessions, users, userTwoFactors } from '../../db/schema';
import { decryptString, encryptString, sha256Hex } from '../../crypto';
import { AppError, invalidState, validationError } from '../../errors';
import { recordAudit } from '../audit/audit.service';

/**
 * TOTP second factor for portal users (docs/02 §3, FR-IAM-03).
 * - secrets encrypted at rest; backup codes stored as SHA-256 hashes, single use
 * - replay protection via the last accepted time-step
 * - 5 consecutive failures lock verification for 15 minutes
 */

const ISSUER = 'GenTouch';
const PURPOSE = 'totp-secret';
const PERIOD_SECONDS = 30;
const MAX_FAILED_ATTEMPTS = 5;
const LOCK_MINUTES = 15;
const BACKUP_CODE_COUNT = 10;

function totpFor(secretBase32: string, label: string): TOTP {
  return new TOTP({
    issuer: ISSUER,
    label,
    algorithm: 'SHA1',
    digits: 6,
    period: PERIOD_SECONDS,
    secret: Secret.fromBase32(secretBase32),
  });
}

/** Returns the accepted time-step for a 6-digit code (±1 step of clock drift), or null. */
function acceptedStep(secretBase32: string, code: string, now: Date): number | null {
  const delta = totpFor(secretBase32, 'verify').validate({ token: code, timestamp: now.getTime(), window: 1 });
  if (delta === null) return null;
  return Math.floor(now.getTime() / 1000 / PERIOD_SECONDS) + delta;
}

const normalizeCode = (code: string) => code.replace(/[\s-]/g, '').toUpperCase();

async function markSessionVerified(tx: Executor, sessionId: string, now: Date) {
  await tx.update(authSessions).set({ twoFactorVerifiedAt: now }).where(eq(authSessions.id, sessionId));
}

export interface TotpSetup {
  otpauthUri: string;
  qrSvg: string;
  /** Base32 secret grouped in fours, for manual entry into an authenticator app. */
  manualKey: string;
}

export async function startTotpSetup(db: Database, user: { id: string; email: string }): Promise<TotpSetup> {
  const [existing] = await db.select().from(userTwoFactors).where(eq(userTwoFactors.userId, user.id));
  if (existing?.confirmedAt) throw invalidState('Two-factor authentication is already turned on.');

  const secret = new Secret({ size: 20 });
  const values = {
    secretEncrypted: encryptString(secret.base32, PURPOSE),
    confirmedAt: null,
    backupCodeHashes: [],
    failedAttempts: 0,
    lockedUntil: null,
    lastUsedStep: null,
  };
  await db
    .insert(userTwoFactors)
    .values({ userId: user.id, ...values })
    .onConflictDoUpdate({ target: userTwoFactors.userId, set: values });

  const otpauthUri = totpFor(secret.base32, user.email).toString();
  const qrSvg = await QRCode.toString(otpauthUri, { type: 'svg', errorCorrectionLevel: 'M', margin: 1 });
  return { otpauthUri, qrSvg, manualKey: secret.base32.match(/.{1,4}/g)!.join(' ') };
}

export async function confirmTotpSetup(
  db: Database,
  ctx: RequestContext,
  input: { userId: string; sessionId: string; code: string },
): Promise<{ backupCodes: string[] }> {
  return db.transaction(async (tx) => {
    const [row] = await tx.select().from(userTwoFactors).where(eq(userTwoFactors.userId, input.userId)).for('update');
    if (!row) throw invalidState('Start two-factor setup first.');
    if (row.confirmedAt) throw invalidState('Two-factor authentication is already turned on.');

    const step = acceptedStep(decryptString(row.secretEncrypted, PURPOSE), normalizeCode(input.code), ctx.now);
    if (step === null) {
      throw validationError({ code: ['That code didn’t match. Check the time on your phone and try the newest code.'] });
    }

    const backupCodes = Array.from({ length: BACKUP_CODE_COUNT }, () => randomCode(8));
    await tx
      .update(userTwoFactors)
      .set({
        confirmedAt: ctx.now,
        backupCodeHashes: backupCodes.map(sha256Hex),
        lastUsedStep: step,
        failedAttempts: 0,
        lockedUntil: null,
        updatedAt: ctx.now,
      })
      .where(eq(userTwoFactors.userId, input.userId));
    await tx.update(users).set({ twoFactorEnabled: true, updatedAt: ctx.now }).where(eq(users.id, input.userId));
    await markSessionVerified(tx, input.sessionId, ctx.now);
    await recordAudit(tx, ctx, {
      category: 'security',
      action: 'auth.two_factor_enabled',
      entityType: 'user',
      entityId: input.userId,
    });
    return { backupCodes: backupCodes.map((c) => `${c.slice(0, 4)}-${c.slice(4)}`) };
  });
}

/** Verifies a TOTP or backup code and marks the current session as second-factor verified. */
export async function verifySecondFactor(
  db: Database,
  ctx: RequestContext,
  input: { userId: string; sessionId: string; code: string },
): Promise<{ usedBackupCode: boolean; remainingBackupCodes: number }> {
  const outcome = await db.transaction(async (tx) => {
    const [row] = await tx.select().from(userTwoFactors).where(eq(userTwoFactors.userId, input.userId)).for('update');
    if (!row?.confirmedAt) throw invalidState('Two-factor authentication is not set up for this account.');

    if (row.lockedUntil && row.lockedUntil > ctx.now) {
      const minutes = Math.ceil((row.lockedUntil.getTime() - ctx.now.getTime()) / 60_000);
      throw new AppError('RATE_LIMITED', `Too many attempts. Please try again in ${minutes} minute${minutes === 1 ? '' : 's'}.`, {
        meta: { retryAfterSeconds: minutes * 60 },
      });
    }

    const code = normalizeCode(input.code);
    let usedBackupCode = false;
    let remaining = row.backupCodeHashes;
    let success = false;
    let step: number | null = row.lastUsedStep;

    if (/^\d{6}$/.test(code)) {
      const accepted = acceptedStep(decryptString(row.secretEncrypted, PURPOSE), code, ctx.now);
      if (accepted !== null && (row.lastUsedStep === null || accepted > row.lastUsedStep)) {
        success = true;
        step = accepted;
      }
    } else if (/^[0-9A-Z]{8}$/.test(code)) {
      const hash = sha256Hex(code);
      if (row.backupCodeHashes.includes(hash)) {
        success = true;
        usedBackupCode = true;
        remaining = row.backupCodeHashes.filter((h) => h !== hash);
      }
    }

    if (!success) {
      const failed = row.failedAttempts + 1;
      const lock = failed >= MAX_FAILED_ATTEMPTS;
      await tx
        .update(userTwoFactors)
        .set({
          failedAttempts: lock ? 0 : failed,
          lockedUntil: lock ? new Date(ctx.now.getTime() + LOCK_MINUTES * 60_000) : row.lockedUntil,
          updatedAt: ctx.now,
        })
        .where(eq(userTwoFactors.userId, input.userId));
      await recordAudit(tx, ctx, {
        category: 'security',
        action: lock ? 'auth.two_factor_locked' : 'auth.two_factor_failed',
        entityType: 'user',
        entityId: input.userId,
      });
      return { success: false as const };
    }

    await tx
      .update(userTwoFactors)
      .set({ failedAttempts: 0, lockedUntil: null, lastUsedStep: step, backupCodeHashes: remaining, updatedAt: ctx.now })
      .where(eq(userTwoFactors.userId, input.userId));
    await markSessionVerified(tx, input.sessionId, ctx.now);
    await recordAudit(tx, ctx, {
      category: 'security',
      action: usedBackupCode ? 'auth.backup_code_used' : 'auth.two_factor_verified',
      entityType: 'user',
      entityId: input.userId,
    });
    return { success: true as const, usedBackupCode, remainingBackupCodes: remaining.length };
  });

  // Failures are committed (attempt counter) before the error is raised.
  if (!outcome.success) throw validationError({ code: ['That code didn’t work. Please try again.'] });
  return { usedBackupCode: outcome.usedBackupCode, remainingBackupCodes: outcome.remainingBackupCodes };
}

export async function twoFactorStatus(db: Database, userId: string) {
  const [row] = await db
    .select({
      confirmedAt: userTwoFactors.confirmedAt,
      backupCodesLeft: sql<number>`cardinality(${userTwoFactors.backupCodeHashes})`,
    })
    .from(userTwoFactors)
    .where(eq(userTwoFactors.userId, userId));
  return { enabled: Boolean(row?.confirmedAt), backupCodesLeft: Number(row?.backupCodesLeft ?? 0) };
}
