import { and, eq, gt, isNull, sql } from 'drizzle-orm';
import { z } from 'zod';
import { formatPhone, normalizePhone } from '@/lib/phone';
import { actorUserId, type RequestContext } from '../../context/request-context';
import { randomToken, sha256Hex, signPayload, verifyPayload } from '../../crypto';
import { queryRows, type Database, type Executor } from '../../db/client';
import { actionTokens, hierarchyNodes, participantKeys, people, personDesignations } from '../../db/schema';
import { getEnv } from '../../env';
import { AppError, conflict, notFound, validationError } from '../../errors';
import { assertCanAccessPerson } from '../../policy/can';
import { parseInput } from '../../validation';
import { recordAudit } from '../audit/audit.service';
import { insertNode, isInSubtree, lockHierarchy, writeHistory } from '../hierarchy/hierarchy.core';
import { findDuplicateMatches, recordDuplicateCandidates } from '../people/dedupe';
import { generatePersonCodes } from '../people/person-codes';
import { getSetting } from '../settings/settings.service';
import { ensureLeaderEntryCode, resolveEntryCode } from './entry-codes.service';
import { participantContext, deviceHint, type ParticipantIdentity, type PublicRequest } from './public-request';
import { assertRateLimit, RATE_LIMITS } from './rate-limit';
import { newId } from '@/lib/ids';

/**
 * Participant identity without accounts (docs/02 §3–4, docs/05 W1–W4). Identification ladder:
 * remembered device → personal link → mobile + first name → registration.
 * Nothing stored about a person is revealed before identification succeeds.
 */

const DEVICE_KEY_DAYS = 365;
const SESSION_KEY_HOURS = 2;
const PERSONAL_LINK_DAYS = 7;

export interface IssuedKey {
  secret: string;
  expiresAt: Date;
  persistent: boolean;
}

// ─── Keys ─────────────────────────────────────────────────────────────────────

export async function issueParticipantKey(
  executor: Executor,
  input: { personId: string; createdVia: ParticipantIdentity['channel']; persistent: boolean; now: Date; userAgent: string | null },
): Promise<IssuedKey> {
  const secret = randomToken(32);
  const expiresAt = new Date(
    input.now.getTime() + (input.persistent ? DEVICE_KEY_DAYS * 86_400_000 : SESSION_KEY_HOURS * 3_600_000),
  );
  await executor.insert(participantKeys).values({
    personId: input.personId,
    keyHash: sha256Hex(secret),
    deviceHint: deviceHint(input.userAgent),
    createdVia: input.createdVia,
    persistent: input.persistent,
    expiresAt,
  });
  return { secret, expiresAt, persistent: input.persistent };
}

/** Resolves a key from the participant's cookie. Remembered devices renew on use (rolling year). */
export async function resolveParticipantKey(executor: Executor, secret: string | undefined | null, now: Date): Promise<ParticipantIdentity | null> {
  if (!secret || secret.length < 32 || secret.length > 64) return null;
  const [row] = await executor
    .select({
      id: participantKeys.id,
      personId: participantKeys.personId,
      createdVia: participantKeys.createdVia,
      persistent: participantKeys.persistent,
      lastUsedAt: participantKeys.lastUsedAt,
    })
    .from(participantKeys)
    .innerJoin(people, eq(people.id, participantKeys.personId))
    .where(
      and(
        eq(participantKeys.keyHash, sha256Hex(secret)),
        isNull(participantKeys.revokedAt),
        gt(participantKeys.expiresAt, now),
        isNull(people.archivedAt),
      ),
    );
  if (!row) return null;
  if (!row.lastUsedAt || now.getTime() - row.lastUsedAt.getTime() > 3_600_000) {
    await executor
      .update(participantKeys)
      .set({
        lastUsedAt: now,
        ...(row.persistent ? { expiresAt: new Date(now.getTime() + DEVICE_KEY_DAYS * 86_400_000) } : {}),
      })
      .where(eq(participantKeys.id, row.id));
  }
  return { keyId: row.id, personId: row.personId, channel: row.createdVia, persistent: row.persistent };
}

/** Portal: sign a person out of every remembered device (e.g. a lost phone, docs/01 E35). */
export async function revokeParticipantKeys(db: Database, ctx: RequestContext, raw: unknown) {
  const { personId } = parseInput(z.object({ personId: z.uuid() }), raw);
  return db.transaction(async (tx) => {
    await assertCanAccessPerson(tx, ctx, 'people.links.issue', personId);
    const revoked = await tx
      .update(participantKeys)
      .set({ revokedAt: ctx.now, revokedReason: 'Revoked from the portal' })
      .where(and(eq(participantKeys.personId, personId), isNull(participantKeys.revokedAt)))
      .returning({ id: participantKeys.id });
    await recordAudit(tx, ctx, {
      category: 'security',
      action: 'participant.keys_revoked',
      entityType: 'person',
      entityId: personId,
      newValues: { count: revoked.length },
    });
    return { revoked: revoked.length };
  });
}

/** "This isn't my phone" / "Forget this device" on the journal page. */
export async function forgetParticipantKey(executor: Executor, identity: ParticipantIdentity, now: Date) {
  await executor
    .update(participantKeys)
    .set({ revokedAt: now, revokedReason: 'Forgotten on the device' })
    .where(and(eq(participantKeys.id, identity.keyId), isNull(participantKeys.revokedAt)));
}

// ─── Form session (anti-automation) ───────────────────────────────────────────

const FORM_SESSION_PURPOSE = 'form-session';
const MIN_FILL_MS = 2_000;
const MAX_FORM_AGE_MS = 6 * 3_600_000;

export function issueFormSession(now: Date): string {
  return signPayload({ iat: now.getTime(), n: randomToken(6) }, FORM_SESSION_PURPOSE);
}

/** Rejects missing, forged, expired, or implausibly fast form submissions. */
export function assertFormSession(token: string | null | undefined, now: Date, options: { minFillMs?: number } = {}) {
  const payload = token ? verifyPayload<{ iat: number }>(token, FORM_SESSION_PURPOSE) : null;
  const age = payload ? now.getTime() - payload.iat : -1;
  if (!payload || age < 0 || age > MAX_FORM_AGE_MS) {
    throw new AppError('VALIDATION_ERROR', 'This page has expired. Please reload and try again.', { meta: { reason: 'FORM_SESSION' } });
  }
  if (age < (options.minFillMs ?? MIN_FILL_MS)) {
    throw new AppError('VALIDATION_ERROR', 'Please try again.', { meta: { reason: 'TOO_FAST' } });
  }
}

// ─── Identify by mobile + first name ──────────────────────────────────────────

export const IdentifyInput = z.object({
  phone: z.string().trim().min(7).max(30),
  firstName: z.string().trim().min(1).max(80),
  rememberDevice: z.boolean().default(true),
});

export type IdentifyResult =
  | { result: 'identified'; key: IssuedKey; firstName: string }
  | { result: 'not_confirmed' }
  | { result: 'use_personal_link' };

export async function identifyParticipant(db: Database, req: PublicRequest, raw: unknown): Promise<IdentifyResult> {
  const input = parseInput(IdentifyInput, raw);
  const [{ phoneMatchEnabled }, { defaultCountry }] = await Promise.all([
    getSetting(db, 'public.identification'),
    getSetting(db, 'ministry.profile'),
  ]);
  if (!phoneMatchEnabled) return { result: 'use_personal_link' };

  if (req.ip) await assertRateLimit(db, `identify:ip:${req.ip}`, RATE_LIMITS.identifyPerIp, req.now);
  const phone = normalizePhone(input.phone, defaultCountry);
  await assertRateLimit(db, `identify:phone:${phone.ok ? phone.e164 : input.phone}`, RATE_LIMITS.identifyPerPhone, req.now);
  if (!phone.ok) return { result: 'not_confirmed' };

  // Exact (accent/case-insensitive) first-name or preferred-name match — never fuzzy.
  const candidates = await queryRows<{ id: string; first_name: string }>(
    db,
    sql`SELECT id, first_name FROM people
         WHERE phone_e164 = ${phone.e164} AND archived_at IS NULL AND registration_status <> 'rejected'
           AND (lower(immutable_unaccent(first_name)) = lower(immutable_unaccent(${input.firstName}))
             OR lower(immutable_unaccent(split_part(first_name, ' ', 1))) = lower(immutable_unaccent(${input.firstName}))
             OR lower(immutable_unaccent(coalesce(preferred_name, ''))) = lower(immutable_unaccent(${input.firstName})))`,
  );
  if (candidates.length === 0) return { result: 'not_confirmed' };
  if (candidates.length > 1) return { result: 'use_personal_link' }; // shared phone and first name

  const person = candidates[0]!;
  const key = await issueParticipantKey(db, {
    personId: person.id,
    createdVia: 'phone_match',
    persistent: input.rememberDevice,
    now: req.now,
    userAgent: req.userAgent,
  });
  await recordAudit(db, participantContext(req, person.id), {
    category: 'auth',
    action: 'participant.identified',
    entityType: 'person',
    entityId: person.id,
    newValues: { via: 'phone_match', rememberDevice: input.rememberDevice },
  });
  return { result: 'identified', key, firstName: person.first_name };
}

// ─── Registration ─────────────────────────────────────────────────────────────

const optionalText = (max: number) =>
  z.preprocess((v) => (typeof v === 'string' && v.trim() === '' ? undefined : v), z.string().trim().max(max).optional());

export const RegisterInput = z.object({
  firstName: z.string().trim().min(1, 'Enter your first name').max(80),
  lastName: z.string().trim().min(1, 'Enter your last name').max(80),
  preferredName: optionalText(80),
  phone: optionalText(30),
  email: z.preprocess((v) => (v === '' ? undefined : v), z.email('Enter a valid email').toLowerCase().optional()),
  leaderRef: z.string().trim().min(8, 'Choose your leader').max(12),
  birthYear: z.preprocess((v) => (v === '' || v == null ? undefined : Number(v)), z.int().min(1900).max(2100).optional()),
  guardianName: optionalText(120),
  guardianRelationship: optionalText(60),
  guardianConsent: z.boolean().optional(),
  consent: z.literal(true, 'Please agree to the privacy notice to continue.'),
  rememberDevice: z.boolean().default(true),
  /** Honeypot: real people never fill this hidden field. */
  website: z.string().max(0, 'Please try again.').optional(),
});

export async function registerParticipant(db: Database, req: PublicRequest, raw: unknown) {
  const input = parseInput(RegisterInput, raw);
  if (req.ip) await assertRateLimit(db, `register:ip:${req.ip}`, RATE_LIMITS.registerPerIp, req.now);

  const [profile, privacy] = await Promise.all([getSetting(db, 'ministry.profile'), getSetting(db, 'privacy')]);
  let phoneE164: string | null = null;
  if (input.phone) {
    const phone = normalizePhone(input.phone, profile.defaultCountry);
    if (!phone.ok) throw validationError({ phone: ['Enter a valid mobile number, for example 0917 123 4567.'] });
    phoneE164 = phone.e164;
  }

  const code = await resolveEntryCode(db, input.leaderRef);
  if (!code || code.status !== 'active' || !code.leader?.placed || !code.leader.acceptsMembers) {
    throw validationError({ leaderRef: ['Please choose your leader again.'] });
  }

  const isMinor = input.birthYear !== undefined && new Date(req.now).getFullYear() - input.birthYear < privacy.adultAge;
  if (isMinor && !privacy.minorsParticipate) {
    throw validationError({ birthYear: ['Please ask your leader to help you get started.'] });
  }
  if (isMinor && (!input.guardianName || input.guardianConsent !== true)) {
    throw validationError({ guardianName: ['A parent or guardian needs to agree before you continue.'] });
  }

  return db.transaction(async (tx) => {
    if (phoneE164) {
      const [existing] = await queryRows<{ id: string }>(
        tx,
        sql`SELECT id FROM people WHERE phone_e164 = ${phoneE164} AND archived_at IS NULL
              AND lower(immutable_unaccent(first_name)) = lower(immutable_unaccent(${input.firstName}))
              AND lower(immutable_unaccent(last_name)) = lower(immutable_unaccent(${input.lastName}))`,
      );
      if (existing) {
        throw conflict('It looks like you have journaled with us before.', { reason: 'ALREADY_REGISTERED' });
      }
    }

    const matches = await findDuplicateMatches(tx, { ...input, phoneE164, email: input.email ?? null });
    const [personCode] = await generatePersonCodes(tx, 1);
    const personId = newId();
    await tx.insert(people).values({
      id: personId,
      personCode: personCode!,
      firstName: input.firstName,
      lastName: input.lastName,
      preferredName: input.preferredName ?? null,
      phoneE164,
      email: input.email ?? null,
      birthYear: input.birthYear ?? null,
      source: 'public_registration',
      registrationStatus: 'unconfirmed',
      consentVersion: privacy.noticeVersion,
      consentAt: req.now,
      guardianName: isMinor ? input.guardianName! : null,
      guardianRelationship: isMinor ? (input.guardianRelationship ?? null) : null,
      guardianConsentAt: isMinor ? req.now : null,
    });
    await tx.insert(personDesignations).values({ personId, designationKey: 'member' });

    await lockHierarchy(tx);
    const { primaryLeaderDepth } = await getSetting(tx, 'hierarchy');
    await insertNode(tx, { personId, parentPersonId: code.leader!.personId, primaryLeaderDepth });
    await writeHistory(
      tx,
      [{ personId, previousLeaderPersonId: null, newLeaderPersonId: code.leader!.personId, changeType: 'placed' }],
      { operationId: newId(), changedBy: null, reason: 'Registered from the daily journal', at: req.now },
    );
    await recordDuplicateCandidates(tx, personId, matches);

    const key = await issueParticipantKey(tx, {
      personId,
      createdVia: 'registration',
      persistent: input.rememberDevice,
      now: req.now,
      userAgent: req.userAgent,
    });
    await recordAudit(tx, participantContext(req, personId), {
      category: 'change',
      action: 'participant.registered',
      entityType: 'person',
      entityId: personId,
      newValues: { leaderId: code.leader!.personId, entryCodeId: code.id, minor: isMinor, rememberDevice: input.rememberDevice },
    });
    return { personId, key, firstName: input.firstName, leaderName: `${code.leader!.firstName} ${code.leader!.lastName.charAt(0)}.` };
  });
}

// ─── Public leader search (docs/01 FR-JRN-05) ─────────────────────────────────

export async function searchPublicLeaders(db: Database, req: PublicRequest, rawQuery: string) {
  const q = rawQuery.trim();
  if (q.length < 2 || q.length > 40) return [];
  if (req.ip) await assertRateLimit(db, `leader-search:ip:${req.ip}`, RATE_LIMITS.leaderSearchPerIp, req.now);

  const rows = await queryRows<{ id: string; first_name: string; last_name: string; primary_first: string | null }>(
    db,
    sql`SELECT p.id, p.first_name, p.last_name,
               CASE WHEN n.primary_leader_person_id <> p.id THEN pl.first_name END AS primary_first
          FROM hierarchy_nodes n
          JOIN people p ON p.id = n.person_id
          LEFT JOIN people pl ON pl.id = n.primary_leader_person_id
         WHERE n.accepts_members AND p.archived_at IS NULL AND p.status = 'active'
           AND (p.search_name % lower(immutable_unaccent(${q}))
                OR p.search_name LIKE lower(immutable_unaccent(${`%${q.toLowerCase().replace(/[\\%_]/g, (c) => `\\${c}`)}%`})))
         ORDER BY similarity(p.search_name, lower(immutable_unaccent(${q}))) DESC
         LIMIT 8`,
  );
  const results = [];
  for (const row of rows) {
    const code = await ensureLeaderEntryCode(db, row.id);
    results.push({
      ref: code.code,
      // First name and initial only: enough to recognise your leader, not a public directory.
      name: `${row.first_name} ${row.last_name.charAt(0)}.`,
      hint: row.primary_first ? `${row.primary_first}’s branch` : null,
    });
  }
  return results;
}

// ─── Personal links (docs/02 §3) ──────────────────────────────────────────────

export async function issuePersonalLink(db: Database, ctx: RequestContext, raw: unknown) {
  const { personId } = parseInput(z.object({ personId: z.uuid() }), raw);
  return db.transaction(async (tx) => {
    await assertCanAccessPerson(tx, ctx, 'people.links.issue', personId);
    const [person] = await tx
      .select({ firstName: people.firstName, phone: people.phoneE164, archivedAt: people.archivedAt })
      .from(people)
      .where(eq(people.id, personId));
    if (!person || person.archivedAt) throw notFound('person');

    // Only the newest link works.
    await tx
      .update(actionTokens)
      .set({ revokedAt: ctx.now })
      .where(and(eq(actionTokens.personId, personId), eq(actionTokens.purpose, 'personal_key_install'), isNull(actionTokens.revokedAt)));
    const token = randomToken(32);
    const expiresAt = new Date(ctx.now.getTime() + PERSONAL_LINK_DAYS * 86_400_000);
    await tx.insert(actionTokens).values({
      tokenHash: sha256Hex(token),
      purpose: 'personal_key_install',
      personId,
      expiresAt,
      maxUses: 1,
      createdBy: actorUserId(ctx),
    });
    await recordAudit(tx, ctx, { category: 'security', action: 'participant.personal_link_issued', entityType: 'person', entityId: personId });
    const { defaultCountry } = await getSetting(tx, 'ministry.profile');
    return {
      url: `${getEnv().APP_URL}/k/${token}`,
      expiresAt,
      firstName: person.firstName,
      phone: person.phone ? formatPhone(person.phone, defaultCountry) : null,
    };
  });
}

async function findUsableLinkToken(executor: Executor, token: string, now: Date, forUpdate: boolean) {
  if (!/^[A-Za-z0-9_-]{32,64}$/.test(token)) return null;
  const query = executor
    .select({
      id: actionTokens.id,
      personId: actionTokens.personId,
      firstName: people.firstName,
      lastName: people.lastName,
      useCount: actionTokens.useCount,
      maxUses: actionTokens.maxUses,
    })
    .from(actionTokens)
    .innerJoin(people, eq(people.id, actionTokens.personId))
    .where(
      and(
        eq(actionTokens.tokenHash, sha256Hex(token)),
        eq(actionTokens.purpose, 'personal_key_install'),
        isNull(actionTokens.revokedAt),
        gt(actionTokens.expiresAt, now),
        isNull(people.archivedAt),
      ),
    );
  const [row] = forUpdate ? await query.for('update') : await query;
  return row && row.useCount < row.maxUses ? row : null;
}

/** For the confirmation page: whose link is this? (first name and initial only) */
export async function inspectPersonalLink(db: Executor, token: string, now: Date) {
  const row = await findUsableLinkToken(db, token, now, false);
  return row ? { valid: true as const, name: `${row.firstName} ${row.lastName.charAt(0)}.` } : { valid: false as const };
}

export async function installPersonalLink(db: Database, req: PublicRequest, raw: unknown) {
  const input = parseInput(z.object({ token: z.string().min(32).max(64), rememberDevice: z.boolean().default(true) }), raw);
  if (req.ip) await assertRateLimit(db, `personal-link:ip:${req.ip}`, RATE_LIMITS.personalLinkPerIp, req.now);
  return db.transaction(async (tx) => {
    const row = await findUsableLinkToken(tx, input.token, req.now, true);
    if (!row) throw new AppError('GONE', 'This link has expired or was already used. Please ask your leader for a new one.');
    await tx
      .update(actionTokens)
      .set({ useCount: row.useCount + 1, lastUsedAt: req.now })
      .where(eq(actionTokens.id, row.id));
    const key = await issueParticipantKey(tx, {
      personId: row.personId,
      createdVia: 'personal_link',
      persistent: input.rememberDevice,
      now: req.now,
      userAgent: req.userAgent,
    });
    await recordAudit(tx, participantContext(req, row.personId), {
      category: 'auth',
      action: 'participant.personal_link_used',
      entityType: 'person',
      entityId: row.personId,
    });
    return { key, firstName: row.firstName };
  });
}

// ─── Leader change from the public form (docs/01 BR-H-06) ─────────────────────

/** Creates a pending request (never a direct move). Silently skipped when not applicable. */
export async function requestLeaderChangeFromPublic(executor: Executor, personId: string, toLeaderId: string) {
  const [node] = await executor.select().from(hierarchyNodes).where(eq(hierarchyNodes.personId, personId));
  if (!node || node.parentPersonId === toLeaderId || personId === toLeaderId) return false;
  if (await isInSubtree(executor, personId, toLeaderId)) return false;
  const inserted = await queryRows<{ id: string }>(
    executor,
    sql`INSERT INTO leader_change_requests (id, person_id, from_leader_person_id, to_leader_person_id, source, reason)
        SELECT ${newId()}::uuid, ${personId}::uuid, ${node.parentPersonId}::uuid, ${toLeaderId}::uuid, 'public_form',
               'Sent their journal through this leader''s QR code'
         WHERE NOT EXISTS (SELECT 1 FROM leader_change_requests WHERE person_id = ${personId}::uuid AND status = 'pending')
        RETURNING id`,
  );
  return inserted.length > 0;
}
