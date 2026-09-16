import { and, eq, inArray, sql } from 'drizzle-orm';
import { z } from 'zod';
import { formatPhone } from '@/lib/phone';
import { formatSlotRange } from '@/lib/time-range';
import { actorUserId, type RequestContext } from '../../context/request-context';
import { queryRows, type Database, type Executor } from '../../db/client';
import type { GatheringAssignmentStatus } from '../../db/enums';
import { isUniqueViolation } from '../../db/errors';
import { gatheringAssignments, gatherings, gatheringSchedules, people, servingRoles, teamMemberships, teams } from '../../db/schema';
import { conflict, invalidState, notFound, validationError, type Warning } from '../../errors';
import { canAccessGatheringType, personScopeFilter } from '../../policy/can';
import { parseInput } from '../../validation';
import { recordAudit } from '../audit/audit.service';
import { displayName } from '../people/people.queries';
import { getSetting } from '../settings/settings.service';
import { zonedInstant } from '../journal/journal-dates';
import { issueServingActionLink, revokeServingLinks } from './action-links.service';
import { autoFillRoster, rosterTemplate, type RosterGap } from './autofill';
import { lastServed, peopleServingElsewhere, unavailablePeople } from './availability';
import {
  clockLabel,
  closeServingFollowUps,
  gatheringForActor,
  gatheringName,
  gatheringTypeForActor,
  longDateLabel,
  ministryTimeZone,
  shortDateLabel,
  type GatheringRow,
  type GatheringTypeRow,
} from './common';
import {
  AssignServingInput,
  CancelGatheringInput,
  OneOffGatheringInput,
  PublishRostersInput,
  SubstituteServingInput,
  UpdateGatheringInput,
} from './devotional.schemas';
import { queueServingNotice, rosterPlaces, type RosterPlace } from './notify';

/**
 * A gathering's roster (docs/04 A20, docs/05 W8 steps 5–8 and W14): who serves in which role,
 * their replies and warnings; assigning, substitutes, removing, publishing, rebuilding, cancelling
 * and sharing links. Viewing needs `devotional.view`; every change needs `devotional.manage` for
 * the gathering's type. Before a roster is published it is a draft that nobody has been told about.
 */

const AssignmentRef = z.object({ assignmentId: z.uuid() });
const GatheringRef = z.object({ gatheringId: z.uuid() });

function assertChangeable(gathering: GatheringRow, now: Date) {
  if (gathering.status === 'cancelled') throw invalidState('This gathering was cancelled.');
  if (gathering.endsAt <= now) throw invalidState('This gathering is already over.');
}

async function teamName(executor: Executor, teamId: string | null): Promise<string | null> {
  if (!teamId) return null;
  const [team] = await executor.select({ name: teams.name }).from(teams).where(eq(teams.id, teamId));
  return team?.name ?? null;
}

/** Non-blocking warnings for people on a gathering (BR-D-02, docs/02a `devotional.assign`). */
async function warningsFor(executor: Executor, gathering: GatheringRow, personIds: string[]): Promise<Map<string, Warning[]>> {
  const unique = [...new Set(personIds)];
  const [unavailable, busy, members, team] = await Promise.all([
    unavailablePeople(executor, unique, gathering.startsAt, gathering.endsAt),
    peopleServingElsewhere(executor, unique, { startsAt: gathering.startsAt, endsAt: gathering.endsAt, exceptGatheringId: gathering.id }),
    gathering.teamId && unique.length > 0
      ? executor
          .select({ personId: teamMemberships.personId })
          .from(teamMemberships)
          .where(and(eq(teamMemberships.teamId, gathering.teamId), inArray(teamMemberships.personId, unique), sql`${teamMemberships.leftOn} IS NULL`))
      : Promise.resolve(null),
    teamName(executor, gathering.teamId),
  ]);
  const onTeam = members ? new Set(members.map((m) => m.personId)) : null;
  return new Map(
    unique.map((personId) => {
      const warnings: Warning[] = [];
      if (unavailable.has(personId)) warnings.push({ code: 'UNAVAILABLE', message: 'Marked away on this day' });
      if (busy.has(personId)) warnings.push({ code: 'OVERLAP', message: 'Also serving at another gathering at this time' });
      if (onTeam && !onTeam.has(personId)) warnings.push({ code: 'NOT_TEAM_MEMBER', message: `Not on ${team ?? 'this team'}` });
      return [personId, warnings];
    }),
  );
}

/** Required roles that don't have enough people yet. */
export async function openRequiredRoles(executor: Executor, gathering: GatheringRow): Promise<RosterGap[]> {
  const template = await rosterTemplate(executor, gathering.gatheringTypeId);
  if (template.length === 0) return [];
  const counts = await queryRows<{ serving_role_id: string; n: number }>(
    executor,
    sql`SELECT serving_role_id, count(*)::int AS n FROM gathering_assignments
         WHERE gathering_id = ${gathering.id}::uuid AND status IN ('pending', 'confirmed')
         GROUP BY serving_role_id`,
  );
  const have = new Map(counts.map((c) => [c.serving_role_id, Number(c.n)]));
  return template
    .map((role) => ({ servingRoleId: role.serving_role_id, roleName: role.role_name, missing: role.min_count - (have.get(role.serving_role_id) ?? 0) }))
    .filter((gap) => gap.missing > 0);
}

// ─── The roster ───────────────────────────────────────────────────────────────

export async function getGatheringRoster(db: Database, ctx: RequestContext, raw: unknown) {
  const { gatheringId } = parseInput(GatheringRef, raw);
  const { gathering, type } = await gatheringForActor(db, ctx, 'devotional.view', gatheringId);
  const [timeZone, { defaultCountry }] = await Promise.all([ministryTimeZone(db), getSetting(db, 'ministry.profile')]);

  const rows = await queryRows<{
    id: string;
    person_id: string;
    serving_role_id: string;
    status: GatheringAssignmentStatus;
    source: string;
    response_note: string | null;
    responded_at: Date | string | null;
    notified_at: Date | string | null;
    first_name: string;
    last_name: string;
    preferred_name: string | null;
    phone: string | null;
    role_name: string;
    original_first_name: string | null;
    original_last_name: string | null;
    original_preferred_name: string | null;
  }>(
    db,
    sql`SELECT ga.id, ga.person_id, ga.serving_role_id, ga.status, ga.source, ga.response_note, ga.responded_at, ga.notified_at,
               p.first_name, p.last_name, p.preferred_name,
               CASE WHEN ${personScopeFilter(ctx, 'people.contact.view', sql`p.id`)} THEN p.phone_e164 END AS phone,
               sr.name AS role_name,
               op.first_name AS original_first_name, op.last_name AS original_last_name, op.preferred_name AS original_preferred_name
          FROM gathering_assignments ga
          JOIN people p ON p.id = ga.person_id
          JOIN serving_roles sr ON sr.id = ga.serving_role_id
          LEFT JOIN gathering_assignments orig ON orig.id = ga.substitute_for_id
          LEFT JOIN people op ON op.id = orig.person_id
         WHERE ga.gathering_id = ${gathering.id}::uuid AND ga.status IN ('pending', 'confirmed', 'declined')
         ORDER BY sr.sort_order, sr.name, ga.created_at`,
  );

  const [template, warnings, team, schedule] = await Promise.all([
    rosterTemplate(db, type.id),
    warningsFor(db, gathering, rows.filter((r) => r.status !== 'declined').map((r) => r.person_id)),
    teamName(db, gathering.teamId),
    gathering.scheduleId
      ? db.select({ name: gatheringSchedules.name }).from(gatheringSchedules).where(eq(gatheringSchedules.id, gathering.scheduleId))
      : Promise.resolve([]),
  ]);

  const toAssignment = (r: (typeof rows)[number]) => ({
    id: r.id,
    personId: r.person_id,
    name: displayName({ firstName: r.first_name, lastName: r.last_name, preferredName: r.preferred_name }),
    status: r.status,
    source: r.source,
    responseNote: r.response_note,
    respondedAt: r.responded_at ? new Date(r.responded_at) : null,
    notified: r.notified_at !== null,
    substituteFor: r.original_first_name
      ? displayName({ firstName: r.original_first_name, lastName: r.original_last_name ?? '', preferredName: r.original_preferred_name })
      : null,
    phone: r.phone ? formatPhone(r.phone, defaultCountry) : null,
    warnings: r.status === 'declined' ? [] : (warnings.get(r.person_id) ?? []),
  });

  const templateIds = new Set(template.map((t) => t.serving_role_id));
  const roles = [
    ...template.map((role) => ({ servingRoleId: role.serving_role_id, name: role.role_name, minCount: role.min_count, maxCount: role.max_count, inTemplate: true })),
    ...[...new Map(rows.filter((r) => !templateIds.has(r.serving_role_id)).map((r) => [r.serving_role_id, r.role_name])).entries()].map(([servingRoleId, name]) => ({
      servingRoleId,
      name,
      minCount: 0,
      maxCount: 0,
      inTemplate: false,
    })),
  ].map((role) => {
    const assignments = rows.filter((r) => r.serving_role_id === role.servingRoleId).map(toAssignment);
    const filled = assignments.filter((a) => a.status !== 'declined').length;
    return { ...role, assignments, filled, open: Math.max(0, role.minCount - filled) };
  });

  const isOver = gathering.endsAt <= ctx.now;
  const manage = canAccessGatheringType(ctx, 'devotional.manage', type) && gathering.status === 'scheduled' && !isOver;
  return {
    gathering: {
      id: gathering.id,
      name: gatheringName(type, gathering),
      title: gathering.title,
      typeId: type.id,
      typeName: type.name,
      occursOn: gathering.occursOn,
      dateLabel: longDateLabel(gathering.startsAt, timeZone),
      timeLabel: formatSlotRange(gathering.startsAt, gathering.endsAt, timeZone),
      status: gathering.status,
      cancelReason: gathering.cancelReason,
      notes: gathering.notes,
      teamId: gathering.teamId,
      teamName: team,
      scheduleName: schedule[0]?.name ?? null,
      published: gathering.rosterPublishedAt !== null,
      isOver,
    },
    roles,
    summary: {
      confirmed: rows.filter((r) => r.status === 'confirmed').length,
      pending: rows.filter((r) => r.status === 'pending').length,
      declined: rows.filter((r) => r.status === 'declined').length,
      openRequired: roles.reduce((sum, role) => sum + role.open, 0),
    },
    can: { manage, publish: manage && gathering.rosterPublishedAt === null, rebuild: manage && gathering.rosterPublishedAt === null },
  };
}

// ─── Choosing people ──────────────────────────────────────────────────────────

export const ServingPeopleSearchInput = z.object({
  gatheringId: z.uuid(),
  servingRoleId: z.uuid().optional(),
  q: z.string().trim().max(80).default(''),
});

/**
 * People a coordinator can put on a roster: names and person codes only, never contact details.
 * People who play the role, then the gathering's team, come first; with fewer than two letters
 * typed, only they are listed.
 */
export async function searchServingPeople(db: Database, ctx: RequestContext, raw: unknown) {
  const input = parseInput(ServingPeopleSearchInput, raw);
  const { gathering } = await gatheringForActor(db, ctx, 'devotional.manage', input.gatheringId);
  const onTeam = gathering.teamId
    ? sql`EXISTS (SELECT 1 FROM team_memberships tm WHERE tm.team_id = ${gathering.teamId}::uuid AND tm.person_id = p.id AND tm.left_on IS NULL)`
    : sql`FALSE`;
  const playsRole = input.servingRoleId
    ? sql`EXISTS (SELECT 1 FROM team_member_serving_roles tmsr JOIN team_memberships tr ON tr.id = tmsr.team_membership_id AND tr.left_on IS NULL
                   WHERE tr.person_id = p.id AND tmsr.serving_role_id = ${input.servingRoleId}::uuid)`
    : sql`FALSE`;
  const q = input.q;
  const escaped = q.toLowerCase().replace(/[\\%_]/g, (c) => `\\${c}`);
  const matches =
    q.length < 2
      ? sql`(${onTeam} OR ${playsRole})`
      : sql`(p.search_name % lower(immutable_unaccent(${q})) OR p.search_name LIKE lower(immutable_unaccent(${`%${escaped}%`})))`;
  const rows = await queryRows<{ id: string; first_name: string; last_name: string; preferred_name: string | null; person_code: string; on_team: boolean; plays_role: boolean }>(
    db,
    sql`SELECT p.id, p.first_name, p.last_name, p.preferred_name, p.person_code, ${onTeam} AS on_team, ${playsRole} AS plays_role
          FROM people p
         WHERE p.archived_at IS NULL AND p.registration_status = 'confirmed' AND ${matches}
         ORDER BY plays_role DESC, on_team DESC, p.last_name, p.first_name
         LIMIT 20`,
  );
  return rows.map((r) => ({
    personId: r.id,
    name: displayName({ firstName: r.first_name, lastName: r.last_name, preferredName: r.preferred_name }),
    personCode: r.person_code,
    onTeam: r.on_team,
    playsRole: r.plays_role,
  }));
}

/**
 * Substitute suggestions (docs/05 W14, BR-D-04): people who play the role on a team, the
 * gathering's team first; never someone unavailable, already on this roster or serving elsewhere
 * at that time; whoever served in the role least recently first.
 */
export async function suggestServingSubstitutes(db: Database, ctx: RequestContext, raw: unknown) {
  const { assignmentId } = parseInput(AssignmentRef, raw);
  const [assignment] = await db
    .select({ gatheringId: gatheringAssignments.gatheringId, personId: gatheringAssignments.personId, servingRoleId: gatheringAssignments.servingRoleId, roleName: servingRoles.name })
    .from(gatheringAssignments)
    .innerJoin(servingRoles, eq(servingRoles.id, gatheringAssignments.servingRoleId))
    .where(eq(gatheringAssignments.id, assignmentId));
  if (!assignment) throw notFound('roster place');
  const { gathering } = await gatheringForActor(db, ctx, 'devotional.manage', assignment.gatheringId);
  const timeZone = await ministryTimeZone(db);

  const candidates = await queryRows<{ person_id: string; first_name: string; last_name: string; preferred_name: string | null; team_name: string; same_team: boolean }>(
    db,
    sql`SELECT DISTINCT ON (tm.person_id) tm.person_id, p.first_name, p.last_name, p.preferred_name, t.name AS team_name,
               (t.id = ${gathering.teamId}::uuid) IS TRUE AS same_team
          FROM team_member_serving_roles tmsr
          JOIN team_memberships tm ON tm.id = tmsr.team_membership_id AND tm.left_on IS NULL
          JOIN teams t ON t.id = tm.team_id AND t.archived_at IS NULL
          JOIN people p ON p.id = tm.person_id AND p.archived_at IS NULL AND p.status = 'active'
         WHERE tmsr.serving_role_id = ${assignment.servingRoleId}::uuid
           AND tm.person_id <> ${assignment.personId}::uuid
           AND NOT EXISTS (SELECT 1 FROM gathering_assignments here
                            WHERE here.gathering_id = ${gathering.id}::uuid AND here.person_id = tm.person_id
                              AND here.status IN ('pending', 'confirmed'))
         ORDER BY tm.person_id, (t.id = ${gathering.teamId}::uuid) IS TRUE DESC`,
  );
  const ids = candidates.map((c) => c.person_id);
  const [unavailable, busy, served] = await Promise.all([
    unavailablePeople(db, ids, gathering.startsAt, gathering.endsAt),
    peopleServingElsewhere(db, ids, { startsAt: gathering.startsAt, endsAt: gathering.endsAt, exceptGatheringId: gathering.id }),
    lastServed(db, ids, gathering.startsAt),
  ]);
  const lastIn = (personId: string) => served.get(`${personId}:${assignment.servingRoleId}`) ?? null;

  return candidates
    .filter((c) => !unavailable.has(c.person_id) && !busy.has(c.person_id))
    .sort(
      (a, b) =>
        Number(b.same_team) - Number(a.same_team) ||
        (lastIn(a.person_id)?.getTime() ?? 0) - (lastIn(b.person_id)?.getTime() ?? 0) ||
        a.last_name.localeCompare(b.last_name) ||
        a.first_name.localeCompare(b.first_name),
    )
    .slice(0, 8)
    .map((c) => {
      const last = lastIn(c.person_id);
      return {
        personId: c.person_id,
        name: displayName({ firstName: c.first_name, lastName: c.last_name, preferredName: c.preferred_name }),
        reasons: [
          c.same_team ? `On ${c.team_name}` : `From ${c.team_name}`,
          'Free at this time',
          last ? `Last served as ${assignment.roleName} on ${shortDateLabel(last, timeZone)}` : `Hasn’t served as ${assignment.roleName} yet`,
        ],
      };
    });
}

// ─── Assign, substitute, remove ───────────────────────────────────────────────

async function placeFor(executor: Executor, assignmentId: string): Promise<RosterPlace> {
  const [place] = await rosterPlaces(executor, sql`ga.id = ${assignmentId}::uuid`);
  if (!place) throw notFound('roster place');
  return place;
}

async function lockedAssignment(tx: Executor, ctx: RequestContext, assignmentId: string) {
  const [assignment] = await tx.select().from(gatheringAssignments).where(eq(gatheringAssignments.id, assignmentId)).for('update');
  if (!assignment) throw notFound('roster place');
  const row = await gatheringForActor(tx, ctx, 'devotional.manage', assignment.gatheringId, { forUpdate: true });
  return { assignment, ...row };
}

async function assertActivePerson(executor: Executor, personId: string) {
  const [person] = await executor.select({ archivedAt: people.archivedAt }).from(people).where(eq(people.id, personId));
  if (!person || person.archivedAt) throw notFound('person');
}

export async function assignServing(db: Database, ctx: RequestContext, raw: unknown) {
  const input = parseInput(AssignServingInput, raw);
  return db.transaction(async (tx) => {
    const { gathering } = await gatheringForActor(tx, ctx, 'devotional.manage', input.gatheringId, { forUpdate: true });
    assertChangeable(gathering, ctx.now);
    const [role] = await tx.select({ isActive: servingRoles.isActive }).from(servingRoles).where(eq(servingRoles.id, input.servingRoleId));
    if (!role?.isActive) throw notFound('serving role');
    await assertActivePerson(tx, input.personId);

    const published = gathering.rosterPublishedAt !== null;
    let assignmentId: string;
    try {
      const [row] = await tx
        .insert(gatheringAssignments)
        .values({
          gatheringId: gathering.id,
          servingRoleId: input.servingRoleId,
          personId: input.personId,
          source: 'manual',
          assignedBy: actorUserId(ctx),
          notifiedAt: published ? ctx.now : null,
          createdAt: ctx.now,
          updatedAt: ctx.now,
        })
        .returning({ id: gatheringAssignments.id });
      assignmentId = row!.id;
    } catch (error) {
      if (isUniqueViolation(error)) throw conflict('This person already has that role in this gathering.');
      throw error;
    }
    if (published) {
      await queueServingNotice(tx, 'devotional.assigned', await placeFor(tx, assignmentId), await ministryTimeZone(tx), `serving_assigned:${assignmentId}`);
    }
    await recordAudit(tx, ctx, {
      category: 'change',
      action: 'devotional.assigned',
      entityType: 'gathering',
      entityId: gathering.id,
      newValues: { assignmentId, servingRoleId: input.servingRoleId, personId: input.personId },
    });
    return { assignmentId, warnings: (await warningsFor(tx, gathering, [input.personId])).get(input.personId) ?? [] };
  });
}

export async function substituteServing(db: Database, ctx: RequestContext, raw: unknown) {
  const input = parseInput(SubstituteServingInput, raw);
  return db.transaction(async (tx) => {
    const { assignment: original, gathering } = await lockedAssignment(tx, ctx, input.assignmentId);
    assertChangeable(gathering, ctx.now);
    if (!['pending', 'confirmed', 'declined'].includes(original.status)) throw invalidState('This person is no longer on the roster.');
    if (input.personId === original.personId) throw validationError({ personId: ['Choose someone else.'] });
    await assertActivePerson(tx, input.personId);

    const published = gathering.rosterPublishedAt !== null;
    const originalPlace = await placeFor(tx, original.id);
    let substituteId: string;
    try {
      const [row] = await tx
        .insert(gatheringAssignments)
        .values({
          gatheringId: gathering.id,
          servingRoleId: original.servingRoleId,
          personId: input.personId,
          source: 'substitute',
          substituteForId: original.id,
          assignedBy: actorUserId(ctx),
          notifiedAt: published ? ctx.now : null,
          createdAt: ctx.now,
          updatedAt: ctx.now,
        })
        .returning({ id: gatheringAssignments.id });
      substituteId = row!.id;
    } catch (error) {
      if (isUniqueViolation(error)) throw conflict('This person already has that role in this gathering.');
      throw error;
    }
    await tx.update(gatheringAssignments).set({ status: 'replaced', updatedAt: ctx.now }).where(eq(gatheringAssignments.id, original.id));
    await revokeServingLinks(tx, [original.id], ctx.now);
    await closeServingFollowUps(tx, [original.id], { note: 'A substitute is serving', resolvedBy: actorUserId(ctx), now: ctx.now });

    const timeZone = await ministryTimeZone(tx);
    if (published) {
      await queueServingNotice(tx, 'devotional.assigned', await placeFor(tx, substituteId), timeZone, `serving_assigned:${substituteId}`);
    }
    // Someone who asked to be replaced already knows; anyone else who was told is told about the change.
    if (original.notifiedAt && original.status !== 'declined') {
      await queueServingNotice(tx, 'devotional.assignment_removed', originalPlace, timeZone, `serving_removed:${original.id}`);
    }
    await recordAudit(tx, ctx, {
      category: 'change',
      action: 'devotional.substituted',
      entityType: 'gathering',
      entityId: gathering.id,
      oldValues: { assignmentId: original.id, personId: original.personId, status: original.status },
      newValues: { assignmentId: substituteId, personId: input.personId },
    });
    return { substituteAssignmentId: substituteId, warnings: (await warningsFor(tx, gathering, [input.personId])).get(input.personId) ?? [] };
  });
}

export async function removeServingAssignment(db: Database, ctx: RequestContext, raw: unknown) {
  const { assignmentId } = parseInput(AssignmentRef, raw);
  return db.transaction(async (tx) => {
    const { assignment, gathering } = await lockedAssignment(tx, ctx, assignmentId);
    assertChangeable(gathering, ctx.now);
    if (!['pending', 'confirmed', 'declined'].includes(assignment.status)) throw invalidState('This person is no longer on the roster.');
    const place = await placeFor(tx, assignment.id);

    await tx.update(gatheringAssignments).set({ status: 'cancelled', updatedAt: ctx.now }).where(eq(gatheringAssignments.id, assignment.id));
    await revokeServingLinks(tx, [assignment.id], ctx.now);
    await closeServingFollowUps(tx, [assignment.id], { note: 'Taken off the roster', resolvedBy: actorUserId(ctx), now: ctx.now });
    if (assignment.notifiedAt && assignment.status !== 'declined') {
      await queueServingNotice(tx, 'devotional.assignment_removed', place, await ministryTimeZone(tx), `serving_removed:${assignment.id}`);
    }
    await recordAudit(tx, ctx, {
      category: 'change',
      action: 'devotional.assignment_removed',
      entityType: 'gathering',
      entityId: gathering.id,
      oldValues: { assignmentId: assignment.id, personId: assignment.personId, status: assignment.status },
    });
  });
}

// ─── Publish, rebuild ─────────────────────────────────────────────────────────

/**
 * Publishes draft rosters (docs/05 W8 step 6): everyone on them is told, with a personal link.
 * Rosters with required roles still open are left for a second, deliberate `force`.
 */
export async function publishRosters(db: Database, ctx: RequestContext, raw: unknown) {
  const input = parseInput(PublishRostersInput, raw);
  return db.transaction(async (tx) => {
    const timeZone = await ministryTimeZone(tx);
    const result = {
      published: [] as string[],
      needsForce: [] as { gatheringId: string; name: string; dateLabel: string; openRoles: string[] }[],
      skipped: 0,
    };
    for (const gatheringId of [...new Set(input.gatheringIds)]) {
      const { gathering, type } = await gatheringForActor(tx, ctx, 'devotional.manage', gatheringId, { forUpdate: true });
      if (gathering.status !== 'scheduled' || gathering.endsAt <= ctx.now || gathering.rosterPublishedAt) {
        result.skipped += 1;
        continue;
      }
      const gaps = await openRequiredRoles(tx, gathering);
      if (gaps.length > 0 && !input.force) {
        result.needsForce.push({
          gatheringId: gathering.id,
          name: gatheringName(type, gathering),
          dateLabel: shortDateLabel(gathering.startsAt, timeZone),
          openRoles: gaps.map((gap) => (gap.missing > 1 ? `${gap.roleName} ×${gap.missing}` : gap.roleName)),
        });
        continue;
      }

      await tx.update(gatherings).set({ rosterPublishedAt: ctx.now, updatedAt: ctx.now }).where(eq(gatherings.id, gathering.id));
      const places = await rosterPlaces(tx, sql`ga.gathering_id = ${gathering.id}::uuid AND ga.status = 'pending' AND ga.notified_at IS NULL`);
      for (const place of places) {
        await queueServingNotice(tx, 'devotional.assigned', place, timeZone, `serving_assigned:${place.assignmentId}`);
      }
      if (places.length > 0) {
        await tx
          .update(gatheringAssignments)
          .set({ notifiedAt: ctx.now, updatedAt: ctx.now })
          .where(inArray(gatheringAssignments.id, places.map((p) => p.assignmentId)));
      }
      await recordAudit(tx, ctx, {
        category: 'change',
        action: 'devotional.roster_published',
        entityType: 'gathering',
        entityId: gathering.id,
        newValues: { notified: places.length, openRoles: gaps.length },
      });
      result.published.push(gathering.id);
    }
    return result;
  });
}

/** Refills a draft roster from its team (docs/02a `devotional.gathering.rebuildRoster`). */
export async function rebuildRoster(db: Database, ctx: RequestContext, raw: unknown) {
  const { gatheringId } = parseInput(GatheringRef, raw);
  return db.transaction(async (tx) => {
    const { gathering } = await gatheringForActor(tx, ctx, 'devotional.manage', gatheringId, { forUpdate: true });
    assertChangeable(gathering, ctx.now);
    if (gathering.rosterPublishedAt) throw invalidState('This roster is already published. Change people one at a time instead.');
    // A draft roster was never shared: no links, notices or replies exist yet.
    await tx.delete(gatheringAssignments).where(eq(gatheringAssignments.gatheringId, gathering.id));
    const filled = await autoFillRoster(tx, gathering);
    await recordAudit(tx, ctx, {
      category: 'change',
      action: 'devotional.roster_rebuilt',
      entityType: 'gathering',
      entityId: gathering.id,
      newValues: { assigned: filled.assigned, openRoles: filled.gaps.length },
    });
    return filled;
  });
}

// ─── Gatherings: one-off, details, cancel ─────────────────────────────────────

/** Cancels gatherings: people come off the rosters, links stop working, and confirmed people are told (BR-D-05). */
export async function cancelGatheringsInTx(tx: Executor, ctx: RequestContext, rows: { gathering: GatheringRow; type: GatheringTypeRow }[], reason: string) {
  if (rows.length === 0) return { gatherings: 0, notified: 0 };
  const ids = rows.map((r) => r.gathering.id);
  const timeZone = await ministryTimeZone(tx);
  const places = await rosterPlaces(tx, sql`ga.gathering_id IN (${sql.join(ids.map((id) => sql`${id}::uuid`), sql`, `)}) AND ga.status IN ('pending', 'confirmed', 'declined')`);

  await tx
    .update(gatherings)
    .set({ status: 'cancelled', cancelReason: reason, updatedAt: ctx.now })
    .where(inArray(gatherings.id, ids));
  if (places.length > 0) {
    const assignmentIds = places.map((p) => p.assignmentId);
    await tx.update(gatheringAssignments).set({ status: 'cancelled', updatedAt: ctx.now }).where(inArray(gatheringAssignments.id, assignmentIds));
    await revokeServingLinks(tx, assignmentIds, ctx.now);
    await closeServingFollowUps(tx, assignmentIds, { note: 'The gathering was cancelled', resolvedBy: actorUserId(ctx), now: ctx.now });
  }
  let notified = 0;
  for (const place of places.filter((p) => p.status === 'confirmed' && p.startsAt > ctx.now)) {
    if (await queueServingNotice(tx, 'devotional.cancelled', place, timeZone, `serving_cancelled:${place.assignmentId}`, { reason })) notified += 1;
  }
  for (const { gathering } of rows) {
    await recordAudit(tx, ctx, {
      category: 'change',
      action: 'devotional.gathering_cancelled',
      entityType: 'gathering',
      entityId: gathering.id,
      newValues: { reason },
    });
  }
  return { gatherings: rows.length, notified };
}

export async function cancelGathering(db: Database, ctx: RequestContext, raw: unknown) {
  const input = parseInput(CancelGatheringInput, raw);
  return db.transaction(async (tx) => {
    const row = await gatheringForActor(tx, ctx, 'devotional.manage', input.gatheringId, { forUpdate: true });
    assertChangeable(row.gathering, ctx.now);
    return cancelGatheringsInTx(tx, ctx, [row], input.reason);
  });
}

export async function updateGatheringDetails(db: Database, ctx: RequestContext, raw: unknown) {
  const input = parseInput(UpdateGatheringInput, raw);
  return db.transaction(async (tx) => {
    const { gathering } = await gatheringForActor(tx, ctx, 'devotional.manage', input.gatheringId, { forUpdate: true });
    if (gathering.status === 'cancelled') throw invalidState('This gathering was cancelled.');
    const next = { title: input.title ?? null, notes: input.notes ?? null };
    await tx.update(gatherings).set({ ...next, updatedAt: ctx.now }).where(eq(gatherings.id, gathering.id));
    await recordAudit(tx, ctx, {
      category: 'change',
      action: 'devotional.gathering_updated',
      entityType: 'gathering',
      entityId: gathering.id,
      oldValues: { title: gathering.title },
      newValues: { title: next.title, notesChanged: next.notes !== gathering.notes },
    });
    return { gatheringId: gathering.id };
  });
}

/** A gathering outside any schedule (docs/02a `devotional.gathering.create`), filled from its team. */
export async function createOneOffGathering(db: Database, ctx: RequestContext, raw: unknown) {
  const input = parseInput(OneOffGatheringInput, raw);
  return db.transaction(async (tx) => {
    const type = await gatheringTypeForActor(tx, ctx, 'devotional.manage', input.gatheringTypeId);
    if (!type.isActive) throw invalidState('This kind of gathering is no longer in use.');
    if (input.teamId) {
      const [team] = await tx.select({ archivedAt: teams.archivedAt }).from(teams).where(eq(teams.id, input.teamId));
      if (!team || team.archivedAt) throw validationError({ teamId: ['Choose an active team.'] });
    }
    const timeZone = await ministryTimeZone(tx);
    const startsAt = zonedInstant(input.date, input.startTime, timeZone);
    const endsAt = new Date(startsAt.getTime() + input.durationMinutes * 60_000);
    if (endsAt <= ctx.now) throw validationError({ date: ['Choose a date and time that hasn’t passed.'] });

    const [gathering] = await tx
      .insert(gatherings)
      .values({
        gatheringTypeId: type.id,
        occursOn: input.date,
        startsAt,
        endsAt,
        teamId: input.teamId ?? null,
        title: input.title ?? null,
        createdBy: actorUserId(ctx),
        createdAt: ctx.now,
        updatedAt: ctx.now,
      })
      .returning();
    const filled = await autoFillRoster(tx, gathering!);
    await recordAudit(tx, ctx, {
      category: 'change',
      action: 'devotional.gathering_created',
      entityType: 'gathering',
      entityId: gathering!.id,
      newValues: { gatheringTypeId: type.id, date: input.date, teamId: input.teamId ?? null },
    });
    return { gatheringId: gathering!.id, assigned: filled.assigned, gaps: filled.gaps };
  });
}

// ─── Links ────────────────────────────────────────────────────────────────────

/** A fresh personal link for the coordinator to share by Messenger or Viber (docs/02a `devotional.shareLink`). */
export async function shareServingLink(db: Database, ctx: RequestContext, raw: unknown) {
  const { assignmentId } = parseInput(AssignmentRef, raw);
  return db.transaction(async (tx) => {
    const [assignment] = await tx.select().from(gatheringAssignments).where(eq(gatheringAssignments.id, assignmentId));
    if (!assignment) throw notFound('roster place');
    const { gathering, type } = await gatheringForActor(tx, ctx, 'devotional.manage', assignment.gatheringId);
    const link = await issueServingActionLink(tx, assignment.id, ctx.now, actorUserId(ctx));
    if (!link) throw invalidState('This roster place is over or no longer active, so it has no link to share.');
    const [person] = await tx.select({ firstName: people.firstName, preferredName: people.preferredName }).from(people).where(eq(people.id, assignment.personId));
    const [role] = await tx.select({ name: servingRoles.name }).from(servingRoles).where(eq(servingRoles.id, assignment.servingRoleId));
    const timeZone = await ministryTimeZone(tx);
    await recordAudit(tx, ctx, {
      category: 'security',
      action: 'devotional.link_shared',
      entityType: 'gathering',
      entityId: gathering.id,
      newValues: { assignmentId: assignment.id, expiresAt: link.expiresAt.toISOString() },
    });
    return {
      url: link.url,
      expiresAt: link.expiresAt,
      firstName: person?.preferredName ?? person?.firstName ?? '',
      gatheringName: gatheringName(type, gathering),
      dateLabel: longDateLabel(gathering.startsAt, timeZone),
      timeLabel: clockLabel(gathering.startsAt, timeZone),
      roleName: role?.name ?? '',
    };
  });
}
