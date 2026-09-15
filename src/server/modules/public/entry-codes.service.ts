import { and, eq, inArray, sql } from 'drizzle-orm';
import { alias } from 'drizzle-orm/pg-core';
import { z } from 'zod';
import { normalizeCode, randomCode } from '@/lib/ids';
import { actorUserId, type RequestContext } from '../../context/request-context';
import type { Database, Executor } from '../../db/client';
import type { ENTRY_CODE_KINDS } from '../../db/enums';
import { entryCodes, hierarchyNodes, people } from '../../db/schema';
import { getEnv } from '../../env';
import { forbidden, notFound } from '../../errors';
import { assertCanAccessPerson, hasGlobal } from '../../policy/can';
import { parseInput } from '../../validation';
import { recordAudit } from '../audit/audit.service';

/**
 * Entry codes behind printed QR codes (docs/02 §5). A code only gives a page its context — the
 * leader to preselect on the journal page, or the prayer chain to show — and grants no access to
 * any data. Codes can be rotated if they leak.
 */

const CODE_PATTERN = /^[0-9A-HJKMNP-TV-Z]{8}$/;

type EntryCodeKind = (typeof ENTRY_CODE_KINDS)[number];

/** The kinds the journal pages accept: a prayer chain code never opens the journal. */
const JOURNAL_CODE_KINDS: readonly EntryCodeKind[] = ['journal_general', 'journal_leader'];

export const journalUrlForCode = (code: string) => `${getEnv().APP_URL}/j/${code}`;
export const prayerUrlForCode = (code: string) => `${getEnv().APP_URL}/pray/${code}`;

export interface ResolvedEntryCode {
  id: string;
  code: string;
  kind: EntryCodeKind;
  status: 'active' | 'retired';
  replacementCode: string | null;
  leader: { personId: string; firstName: string; lastName: string; acceptsMembers: boolean; placed: boolean } | null;
  prayerChainId: string | null;
}

/** Looks up a code of one of `kinds` (journal codes by default); a code of any other kind reads as not found. */
export async function resolveEntryCode(
  executor: Executor,
  raw: string,
  kinds: readonly EntryCodeKind[] = JOURNAL_CODE_KINDS,
): Promise<ResolvedEntryCode | null> {
  const code = normalizeCode(raw);
  if (!CODE_PATTERN.test(code)) return null;
  const replacement = alias(entryCodes, 'replacement');
  const [row] = await executor
    .select({
      id: entryCodes.id,
      code: entryCodes.code,
      kind: entryCodes.kind,
      status: entryCodes.status,
      replacementCode: replacement.code,
      prayerChainId: entryCodes.prayerChainId,
      leaderId: people.id,
      firstName: people.firstName,
      lastName: people.lastName,
      archivedAt: people.archivedAt,
      acceptsMembers: hierarchyNodes.acceptsMembers,
      nodeId: hierarchyNodes.personId,
    })
    .from(entryCodes)
    .leftJoin(replacement, eq(replacement.id, entryCodes.replacedById))
    .leftJoin(people, eq(people.id, entryCodes.leaderPersonId))
    .leftJoin(hierarchyNodes, eq(hierarchyNodes.personId, entryCodes.leaderPersonId))
    .where(and(eq(entryCodes.code, code), inArray(entryCodes.kind, [...kinds])));
  if (!row) return null;
  return {
    id: row.id,
    code: row.code,
    kind: row.kind,
    status: row.leaderId && row.archivedAt ? 'retired' : row.status,
    replacementCode: row.replacementCode,
    leader: row.leaderId
      ? {
          personId: row.leaderId,
          firstName: row.firstName!,
          lastName: row.lastName!,
          acceptsMembers: row.acceptsMembers ?? false,
          placed: Boolean(row.nodeId),
        }
      : null,
    prayerChainId: row.prayerChainId,
  };
}

/** Best-effort scan counter (never blocks the page). */
export async function recordEntryCodeScan(executor: Executor, id: string, now: Date) {
  await executor
    .update(entryCodes)
    .set({ scanCount: sql`${entryCodes.scanCount} + 1`, lastScannedAt: now })
    .where(eq(entryCodes.id, id));
}

export async function getGeneralEntryCode(executor: Executor): Promise<string | null> {
  const [row] = await executor
    .select({ code: entryCodes.code })
    .from(entryCodes)
    .where(and(eq(entryCodes.kind, 'journal_general'), eq(entryCodes.status, 'active')));
  return row?.code ?? null;
}

async function uniqueCode(executor: Executor): Promise<string> {
  for (;;) {
    const code = randomCode(8);
    const [taken] = await executor.select({ id: entryCodes.id }).from(entryCodes).where(eq(entryCodes.code, code));
    if (!taken) return code;
  }
}

/** Returns the leader's active journal code, creating one on first use. */
export async function ensureLeaderEntryCode(executor: Executor, leaderPersonId: string, createdBy: string | null = null) {
  const [existing] = await executor
    .select({ id: entryCodes.id, code: entryCodes.code })
    .from(entryCodes)
    .where(and(eq(entryCodes.leaderPersonId, leaderPersonId), eq(entryCodes.kind, 'journal_leader'), eq(entryCodes.status, 'active')));
  if (existing) return existing;
  const [created] = await executor
    .insert(entryCodes)
    .values({ code: await uniqueCode(executor), kind: 'journal_leader', leaderPersonId, createdBy })
    .onConflictDoNothing()
    .returning({ id: entryCodes.id, code: entryCodes.code });
  if (created) return created;
  // Lost a race with a concurrent request: read the winner.
  const [winner] = await executor
    .select({ id: entryCodes.id, code: entryCodes.code })
    .from(entryCodes)
    .where(and(eq(entryCodes.leaderPersonId, leaderPersonId), eq(entryCodes.kind, 'journal_leader'), eq(entryCodes.status, 'active')));
  return winner!;
}

/** Returns the prayer chain's active public code (`/pray/{code}`), creating one on first use. */
export async function ensureChainEntryCode(executor: Executor, prayerChainId: string, label: string | null, createdBy: string | null = null) {
  const active = () =>
    executor
      .select({ id: entryCodes.id, code: entryCodes.code })
      .from(entryCodes)
      .where(and(eq(entryCodes.prayerChainId, prayerChainId), eq(entryCodes.kind, 'prayer_chain'), eq(entryCodes.status, 'active')));
  const [existing] = await active();
  if (existing) return existing;
  const [created] = await executor
    .insert(entryCodes)
    .values({ code: await uniqueCode(executor), kind: 'prayer_chain', prayerChainId, label, createdBy })
    .onConflictDoNothing()
    .returning({ id: entryCodes.id, code: entryCodes.code });
  if (created) return created;
  // Lost a race with a concurrent request: read the winner.
  const [winner] = await active();
  return winner!;
}

function assertCodeAccess(ctx: RequestContext, personId: string) {
  const own = ctx.actor.kind === 'user' && ctx.actor.personId === personId;
  if (!hasGlobal(ctx, 'links.manage') && !(own && ctx.actor.kind === 'user' && ctx.actor.grants.some((g) => g.permission === 'links.own.manage'))) {
    throw forbidden('You can manage only your own journal QR code.');
  }
}

/** Portal: a leader's QR code details (links.manage, or links.own.manage for your own code). */
export async function getLeaderJournalCode(db: Database, ctx: RequestContext, personId: string) {
  if (!z.uuid().safeParse(personId).success) throw notFound('person');
  await assertCanAccessPerson(db, ctx, 'people.view', personId);
  assertCodeAccess(ctx, personId);
  const [person] = await db
    .select({ id: people.id, firstName: people.firstName, lastName: people.lastName, archivedAt: people.archivedAt, node: hierarchyNodes.personId })
    .from(people)
    .leftJoin(hierarchyNodes, eq(hierarchyNodes.personId, people.id))
    .where(eq(people.id, personId));
  if (!person || person.archivedAt || !person.node) throw notFound('person');
  const code = await ensureLeaderEntryCode(db, personId, actorUserId(ctx));
  return { code: code.code, url: journalUrlForCode(code.code), leaderName: `${person.firstName} ${person.lastName}` };
}

export async function rotateLeaderJournalCode(db: Database, ctx: RequestContext, raw: unknown) {
  const { personId } = parseInput(z.object({ personId: z.uuid() }), raw);
  await assertCanAccessPerson(db, ctx, 'people.view', personId);
  assertCodeAccess(ctx, personId);
  return db.transaction(async (tx) => {
    const [current] = await tx
      .select()
      .from(entryCodes)
      .where(and(eq(entryCodes.leaderPersonId, personId), eq(entryCodes.kind, 'journal_leader'), eq(entryCodes.status, 'active')))
      .for('update');
    if (current) {
      await tx.update(entryCodes).set({ status: 'retired', retiredAt: ctx.now }).where(eq(entryCodes.id, current.id));
    }
    const [created] = await tx
      .insert(entryCodes)
      .values({ code: await uniqueCode(tx), kind: 'journal_leader', leaderPersonId: personId, createdBy: actorUserId(ctx) })
      .returning({ id: entryCodes.id, code: entryCodes.code });
    if (current) await tx.update(entryCodes).set({ replacedById: created!.id }).where(eq(entryCodes.id, current.id));
    await recordAudit(tx, ctx, {
      category: 'security',
      action: 'entry_code.rotated',
      entityType: 'person',
      entityId: personId,
      oldValues: current ? { code: current.code } : null,
      newValues: { code: created!.code },
    });
    return { code: created!.code, url: journalUrlForCode(created!.code) };
  });
}
