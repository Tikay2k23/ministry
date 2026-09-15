import { and, asc, eq, isNull, sql } from 'drizzle-orm';
import { alias } from 'drizzle-orm/pg-core';
import { z } from 'zod';
import { newId } from '@/lib/ids';
import { formatPhone } from '@/lib/phone';
import { actorUserId, type RequestContext } from '../../context/request-context';
import type { Database } from '../../db/client';
import { hierarchyNodes, participantKeys, people } from '../../db/schema';
import { qualified } from '../../db/sql-helpers';
import { invalidState, notFound } from '../../errors';
import { assertCanAccessPerson, assertPermission, personScopeFilter } from '../../policy/can';
import { parseInput } from '../../validation';
import { recordAudit } from '../audit/audit.service';
import { deleteLeafNode, getNode, lockHierarchy, writeHistory } from '../hierarchy/hierarchy.core';
import { markJournalLedgerDirty } from '../journal/ledger-dirty';
import { getSetting } from '../settings/settings.service';
import { displayName } from './people.queries';

/**
 * Registrations from the public journal (docs/05 W1). People who register are placed under
 * the leader they chose but stay "unconfirmed" — not expected to journal — until a leader
 * or the office confirms them. Declining removes them from the structure and archives them.
 */

const PAGE_SIZE = 50;

export async function listUnconfirmedRegistrations(db: Database, ctx: RequestContext, raw: unknown) {
  assertPermission(ctx, 'people.registrations.confirm');
  const { page } = parseInput(z.object({ page: z.coerce.number().int().min(1).max(10_000).catch(1) }), raw ?? {});
  const { defaultCountry } = await getSetting(db, 'ministry.profile');

  const leader = alias(people, 'leader');
  const where = and(
    eq(people.registrationStatus, 'unconfirmed'),
    isNull(people.archivedAt),
    personScopeFilter(ctx, 'people.registrations.confirm', people.id),
  );
  const rows = await db
    .select({
      id: people.id,
      firstName: people.firstName,
      lastName: people.lastName,
      preferredName: people.preferredName,
      phoneE164: people.phoneE164,
      birthYear: people.birthYear,
      guardianName: people.guardianName,
      createdAt: people.createdAt,
      leaderId: hierarchyNodes.parentPersonId,
      leaderFirstName: leader.firstName,
      leaderLastName: leader.lastName,
      leaderPreferredName: leader.preferredName,
      openDuplicates: sql<number>`(SELECT count(*) FROM person_duplicate_candidates dc
          WHERE dc.status = 'open' AND (dc.person_a_id = ${qualified(people.id)} OR dc.person_b_id = ${qualified(people.id)}))::int`,
    })
    .from(people)
    .leftJoin(hierarchyNodes, eq(hierarchyNodes.personId, people.id))
    .leftJoin(leader, eq(leader.id, hierarchyNodes.parentPersonId))
    .where(where)
    .orderBy(asc(people.createdAt), asc(people.id))
    .limit(PAGE_SIZE)
    .offset((page - 1) * PAGE_SIZE);
  const [count] = await db
    .select({ total: sql<number>`count(*)`.mapWith(Number) })
    .from(people)
    .where(where);

  return {
    items: rows.map((r) => ({
      personId: r.id,
      name: displayName(r),
      phone: r.phoneE164 ? formatPhone(r.phoneE164, defaultCountry) : null,
      birthYear: r.birthYear,
      guardianName: r.guardianName,
      registeredAt: r.createdAt,
      leader:
        r.leaderId && r.leaderFirstName
          ? { id: r.leaderId, name: displayName({ firstName: r.leaderFirstName, lastName: r.leaderLastName!, preferredName: r.leaderPreferredName }) }
          : null,
      leaderName: r.leaderFirstName ? displayName({ firstName: r.leaderFirstName, lastName: r.leaderLastName!, preferredName: r.leaderPreferredName }) : null,
      possibleDuplicates: Number(r.openDuplicates),
    })),
    total: count?.total ?? 0,
    page,
    pageSize: PAGE_SIZE,
  };
}

export const RegistrationDecisionInput = z.object({
  personId: z.uuid(),
  decision: z.enum(['confirm', 'decline']),
  note: z.preprocess((v) => (typeof v === 'string' && v.trim() === '' ? undefined : v), z.string().trim().max(300).optional()),
});

export async function decideRegistration(db: Database, ctx: RequestContext, raw: unknown) {
  const input = parseInput(RegistrationDecisionInput, raw);
  return db.transaction(async (tx) => {
    await assertCanAccessPerson(tx, ctx, 'people.registrations.confirm', input.personId);
    const [person] = await tx.select().from(people).where(eq(people.id, input.personId)).for('update');
    if (!person || person.archivedAt) throw notFound('person');
    if (person.registrationStatus !== 'unconfirmed') throw invalidState('This registration has already been handled.');
    const userId = actorUserId(ctx);

    if (input.decision === 'confirm') {
      await tx
        .update(people)
        .set({ registrationStatus: 'confirmed', updatedAt: ctx.now, updatedBy: userId })
        .where(eq(people.id, person.id));
      // They are now expected to journal from today.
      await markJournalLedgerDirty(tx);
    } else {
      await lockHierarchy(tx);
      const node = await getNode(tx, person.id);
      if (node) {
        await deleteLeafNode(tx, person.id);
        await writeHistory(
          tx,
          [{ personId: person.id, previousLeaderPersonId: node.parentPersonId, newLeaderPersonId: null, changeType: 'removed' }],
          { operationId: newId(), changedBy: userId, reason: 'Registration declined', at: ctx.now },
        );
      }
      await tx
        .update(people)
        .set({ registrationStatus: 'rejected', archivedAt: ctx.now, archivedReason: 'other', updatedAt: ctx.now, updatedBy: userId })
        .where(eq(people.id, person.id));
      await tx
        .update(participantKeys)
        .set({ revokedAt: ctx.now, revokedReason: 'Registration declined' })
        .where(and(eq(participantKeys.personId, person.id), isNull(participantKeys.revokedAt)));
      await markJournalLedgerDirty(tx);
    }

    await recordAudit(tx, ctx, {
      category: 'change',
      action: input.decision === 'confirm' ? 'registration.confirmed' : 'registration.declined',
      entityType: 'person',
      entityId: person.id,
      reason: input.note ?? null,
    });
    return { decision: input.decision };
  });
}
