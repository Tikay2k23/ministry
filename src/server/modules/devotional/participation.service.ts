import { eq, inArray, sql } from 'drizzle-orm';
import { z } from 'zod';
import { formatSlotRange } from '@/lib/time-range';
import { queryRows, type Database, type Executor } from '../../db/client';
import { careFollowups, gatheringAssignments, gatherings, gatheringTypes, people, servingRoles, teams, users } from '../../db/schema';
import { AppError, invalidState } from '../../errors';
import { parseInput } from '../../validation';
import { recordAudit } from '../audit/audit.service';
import { queueNotification } from '../notifications/notifications.service';
import { participantContext, type PublicRequest } from '../public/public-request';
import { assertRateLimit, RATE_LIMITS } from '../public/rate-limit';
import { inspectServingLink, recordServingTokenUse } from './action-links.service';
import { closeServingFollowUps, devotionalCoordinatorUserIds, longDateLabel, ministryTimeZone, servingFollowUpKey, shortDateLabel, shortPersonName } from './common';

/**
 * A serving assignment without logging in (docs/04 P8, docs/05 W9): the page behind a personal link
 * and the reply to it. Opening the page changes nothing; replying is a POST, so link previews in
 * chat apps can't accept or decline by accident. A reply can be changed until the gathering type's
 * lock time before the start; a first reply is always welcome until the gathering starts.
 */

const emptyToUndefined = (value: unknown) => (typeof value === 'string' && value.trim() === '' ? undefined : value);

export const ServingResponseInput = z.object({
  token: z.string().trim().min(32).max(64),
  response: z.enum(['accept', 'decline']),
  note: z.preprocess(emptyToUndefined, z.string().trim().max(500).optional()),
});

export type ServingState = 'pending' | 'confirmed' | 'declined';

export interface ServingView {
  gatheringName: string;
  dateLabel: string;
  timeLabel: string;
  roleName: string;
  teamName: string | null;
  /** First names by role, as on the printed roster. */
  roster: { roleName: string; names: string[] }[];
  state: ServingState;
  responseNote: string | null;
  canRespond: boolean;
  /** Why the reply can't be changed any more, e.g. close to the start. */
  lockedMessage: string | null;
}

async function loadRecord(executor: Executor, assignmentId: string, options: { forUpdate?: boolean } = {}) {
  const query = executor
    .select({
      assignment: gatheringAssignments,
      gathering: gatherings,
      type: gatheringTypes,
      roleName: servingRoles.name,
      teamName: teams.name,
      person: { firstName: people.firstName, lastName: people.lastName, preferredName: people.preferredName },
    })
    .from(gatheringAssignments)
    .innerJoin(gatherings, eq(gatherings.id, gatheringAssignments.gatheringId))
    .innerJoin(gatheringTypes, eq(gatheringTypes.id, gatherings.gatheringTypeId))
    .innerJoin(servingRoles, eq(servingRoles.id, gatheringAssignments.servingRoleId))
    .innerJoin(people, eq(people.id, gatheringAssignments.personId))
    .leftJoin(teams, eq(teams.id, gatherings.teamId))
    .where(eq(gatheringAssignments.id, assignmentId));
  const [row] = options.forUpdate ? await query.for('update', { of: gatheringAssignments }) : await query;
  return row ?? null;
}

type ServingRecord = NonNullable<Awaited<ReturnType<typeof loadRecord>>>;

async function rosterFirstNames(executor: Executor, gatheringId: string) {
  const rows = await queryRows<{ role_name: string; first_name: string }>(
    executor,
    sql`SELECT sr.name AS role_name, coalesce(p.preferred_name, p.first_name) AS first_name
          FROM gathering_assignments ga
          JOIN serving_roles sr ON sr.id = ga.serving_role_id
          JOIN people p ON p.id = ga.person_id
         WHERE ga.gathering_id = ${gatheringId}::uuid AND ga.status IN ('pending', 'confirmed')
         ORDER BY sr.sort_order, sr.name, first_name`,
  );
  const roles = new Map<string, string[]>();
  for (const row of rows) roles.set(row.role_name, [...(roles.get(row.role_name) ?? []), row.first_name]);
  return [...roles.entries()].map(([roleName, names]) => ({ roleName, names }));
}

const isLocked = (record: ServingRecord, now: Date) => now.getTime() >= record.gathering.startsAt.getTime() - record.type.responseLockHours * 3_600_000;

async function viewOf(executor: Executor, record: ServingRecord, now: Date, timeZone: string): Promise<ServingView> {
  const { assignment: a, gathering: g, type } = record;
  const state = a.status as ServingState;
  const started = g.startsAt <= now;
  const changeLocked = state !== 'pending' && isLocked(record, now);
  return {
    gatheringName: g.title ?? type.name,
    dateLabel: longDateLabel(g.startsAt, timeZone),
    timeLabel: formatSlotRange(g.startsAt, g.endsAt, timeZone),
    roleName: record.roleName,
    teamName: record.teamName,
    roster: await rosterFirstNames(executor, g.id),
    state,
    responseNote: a.responseNote,
    canRespond: !started && !changeLocked,
    lockedMessage: started ? 'This gathering has already started.' : changeLocked ? 'It’s close to the start now. To change your reply, please contact your coordinator.' : null,
  };
}

/** The page behind a serving link (docs/04 P8). A cancelled gathering or a changed roster says so kindly. */
export async function getServingByActionLink(db: Database, token: string, now: Date) {
  const link = await inspectServingLink(db, token, now);
  if (link.kind === 'invalid') return { status: 'invalid' as const };
  const record = await loadRecord(db, link.assignmentId);
  if (!record || record.assignment.personId !== link.personId) return { status: 'invalid' as const };
  const timeZone = await ministryTimeZone(db);
  const name = record.gathering.title ?? record.type.name;

  if (record.gathering.status === 'cancelled') {
    return { status: 'cancelled' as const, gatheringName: name, dateLabel: longDateLabel(record.gathering.startsAt, timeZone), reason: record.gathering.cancelReason };
  }
  if (link.kind === 'revoked' || !['pending', 'confirmed', 'declined'].includes(record.assignment.status)) {
    return ['replaced', 'cancelled'].includes(record.assignment.status) ? { status: 'reassigned' as const, gatheringName: name } : { status: 'invalid' as const };
  }
  return {
    status: 'ok' as const,
    firstName: record.person.preferredName ?? record.person.firstName,
    view: await viewOf(db, record, now, timeZone),
  };
}

const gone = () => new AppError('GONE', 'This link can’t be used any more. Please ask your coordinator for a new one.', { meta: { reason: 'GONE' } });

export async function respondToServing(db: Database, req: PublicRequest, raw: unknown) {
  const input = parseInput(ServingResponseInput, raw);
  if (req.ip) await assertRateLimit(db, `serving:respond:ip:${req.ip}`, RATE_LIMITS.servingRespondPerIp, req.now);

  return db.transaction(async (tx) => {
    const link = await inspectServingLink(tx, input.token, req.now);
    if (link.kind === 'invalid') throw gone();
    const record = await loadRecord(tx, link.assignmentId, { forUpdate: true });
    if (!record || record.assignment.personId !== link.personId) throw gone();
    const { assignment: a, gathering: g, type } = record;

    if (g.status === 'cancelled') throw invalidState(`This gathering was cancelled: ${g.cancelReason}`, { reason: 'CANCELLED' });
    if (link.kind === 'revoked' || !['pending', 'confirmed', 'declined'].includes(a.status)) {
      throw invalidState('Your coordinator has changed this roster place. Thank you!', { reason: 'REASSIGNED' });
    }
    if (g.startsAt <= req.now) throw invalidState('This gathering has already started.', { reason: 'STARTED' });

    const target = input.response === 'accept' ? 'confirmed' : 'declined';
    const note = input.response === 'decline' ? (input.note ?? null) : null;
    const timeZone = await ministryTimeZone(tx);
    // A second tap, or a retry after a dropped connection, changes nothing.
    const unchanged = a.status === target && (target === 'confirmed' || note === a.responseNote);
    if (!unchanged) {
      if (a.status !== 'pending' && isLocked(record, req.now)) {
        throw invalidState('It’s close to the start now. To change your reply, please contact your coordinator.', { reason: 'LOCKED' });
      }
      await tx
        .update(gatheringAssignments)
        .set({ status: target, respondedAt: req.now, responseNote: note, updatedAt: req.now })
        .where(eq(gatheringAssignments.id, a.id));

      if (target === 'declined') {
        const coordinators = await devotionalCoordinatorUserIds(tx, type);
        const accounts = coordinators.length > 0 ? await tx.select({ personId: users.personId }).from(users).where(inArray(users.id, coordinators)) : [];
        const gatheringName = g.title ?? type.name;
        await tx
          .insert(careFollowups)
          .values({
            personId: a.personId,
            kind: 'serving_declined',
            sourceType: 'gathering_assignment',
            sourceRef: a.id,
            assignedToPersonId: accounts.find((account) => account.personId)?.personId ?? null,
            summary: `Can’t serve as ${record.roleName}: ${gatheringName}, ${shortDateLabel(g.startsAt, timeZone)}`,
            dedupeKey: servingFollowUpKey(a.id),
          })
          .onConflictDoUpdate({
            target: careFollowups.dedupeKey,
            set: { status: 'open', resolvedAt: null, resolvedBy: null, resolutionNote: null, updatedAt: req.now },
          });
        for (const userId of coordinators) {
          await queueNotification(tx, {
            templateKey: 'devotional.declined',
            recipientUserId: userId,
            payload: {
              personName: shortPersonName(record.person),
              roleName: record.roleName,
              gatheringName,
              dateLabel: longDateLabel(g.startsAt, timeZone),
              gatheringId: g.id,
            },
            dedupeKey: `serving_declined:${a.id}:${userId}:${req.now.getTime()}`,
          });
        }
      } else {
        await closeServingFollowUps(tx, [a.id], { note: 'They can serve after all', resolvedBy: null, now: req.now });
      }
      await recordAudit(tx, participantContext(req, a.personId), {
        category: 'change',
        action: target === 'confirmed' ? 'devotional.reply_accepted' : 'devotional.reply_declined',
        entityType: 'gathering',
        entityId: g.id,
        newValues: { assignmentId: a.id },
      });
    }
    await recordServingTokenUse(tx, link.tokenId, req.now);
    const updated = (await loadRecord(tx, a.id))!;
    return { view: await viewOf(tx, updated, req.now, timeZone) };
  });
}
