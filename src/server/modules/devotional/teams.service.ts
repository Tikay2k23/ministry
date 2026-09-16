import { and, asc, eq, gt, inArray, isNull, sql } from 'drizzle-orm';
import { z } from 'zod';
import type { RequestContext } from '../../context/request-context';
import { queryRows, type Database, type Executor } from '../../db/client';
import { TEAM_MEMBER_ROLES } from '../../db/enums';
import { isUniqueViolation } from '../../db/errors';
import { gatheringTypes, ministries, people, personUnavailability, servingRoles, teamMemberServingRoles, teamMemberships, teams } from '../../db/schema';
import { conflict, forbidden, notFound, validationError } from '../../errors';
import { grantsFor, hasPermission } from '../../policy/can';
import { parseInput } from '../../validation';
import { recordAudit } from '../audit/audit.service';
import { localDate } from '../journal/journal-dates';
import { displayName } from '../people/people.queries';
import { ministryTimeZone, shortDateLabel } from './common';
import { MemberRolesInput } from './devotional.schemas';

/**
 * Worship teams, their members and each member's default serving roles (FR-DEV-03, docs/05 W8
 * step 2, docs/04 A21). Who may manage a team with `devotional.teams.manage`: a global grant; a
 * ministry or team grant for it; or a Worship Coordinator whose gathering type rotates the team or
 * belongs to the team's ministry.
 */

async function manageableTeamIds(executor: Executor, ctx: RequestContext, teamRows: { id: string; ministryId: string }[]): Promise<Set<string>> {
  const grants = grantsFor(ctx, 'devotional.teams.manage');
  if (grants.length === 0 || teamRows.length === 0) return new Set();
  const typeIds = grants.flatMap((g) => (g.scope.type === 'gathering_type' ? [g.scope.gatheringTypeId] : []));
  let rotated = new Set<string>();
  let typeMinistries = new Set<string>();
  if (typeIds.length > 0) {
    const idList = sql.join(typeIds.map((id) => sql`${id}::uuid`), sql`, `);
    const rows = await queryRows<{ team_id: string }>(
      executor,
      sql`SELECT DISTINCT gst.team_id FROM gathering_schedule_teams gst
            JOIN gathering_schedules gs ON gs.id = gst.schedule_id
           WHERE gs.gathering_type_id IN (${idList})`,
    );
    rotated = new Set(rows.map((r) => r.team_id));
    const types = await executor.select({ ministryId: gatheringTypes.ministryId }).from(gatheringTypes).where(inArray(gatheringTypes.id, typeIds));
    typeMinistries = new Set(types.flatMap((t) => (t.ministryId ? [t.ministryId] : [])));
  }
  return new Set(
    teamRows
      .filter(
        (team) =>
          grants.some(
            (g) =>
              g.scope.type === 'global' ||
              (g.scope.type === 'ministry' && g.scope.ministryId === team.ministryId) ||
              (g.scope.type === 'team' && g.scope.teamId === team.id),
          ) ||
          rotated.has(team.id) ||
          typeMinistries.has(team.ministryId),
      )
      .map((team) => team.id),
  );
}

async function teamForActor(executor: Executor, ctx: RequestContext, teamId: string) {
  const [team] = await executor
    .select({ id: teams.id, ministryId: teams.ministryId, name: teams.name })
    .from(teams)
    .where(and(eq(teams.id, teamId), isNull(teams.archivedAt)));
  if (!team || !(await manageableTeamIds(executor, ctx, [team])).has(team.id)) throw notFound('team');
  return team;
}

/** "Sep 12" or "Sep 12 – Sep 14": the local days an unavailability covers. */
function awayLabel(startsAt: Date, endsAt: Date, timeZone: string) {
  const first = localDate(startsAt, timeZone);
  const last = localDate(new Date(endsAt.getTime() - 1), timeZone);
  const label = (instant: Date) => shortDateLabel(instant, timeZone).replace(/^\w+, /, '');
  return first === last ? label(startsAt) : `${label(startsAt)} – ${label(new Date(endsAt.getTime() - 1))}`;
}

export async function listWorshipTeams(db: Database, ctx: RequestContext) {
  if (!hasPermission(ctx, 'devotional.view') && !hasPermission(ctx, 'devotional.teams.manage')) throw notFound('teams');
  const timeZone = await ministryTimeZone(db);
  const teamRows = await queryRows<{ id: string; name: string; ministry_id: string; ministry_name: string }>(
    db,
    sql`SELECT t.id, t.name, t.ministry_id, m.name AS ministry_name
          FROM teams t JOIN ministries m ON m.id = t.ministry_id
         WHERE t.archived_at IS NULL
           AND (t.team_type = 'worship' OR EXISTS (SELECT 1 FROM gathering_schedule_teams gst WHERE gst.team_id = t.id))
         ORDER BY m.name, t.name`,
  );
  if (teamRows.length === 0) return [];

  const members = await db
    .select({
      membershipId: teamMemberships.id,
      teamId: teamMemberships.teamId,
      personId: teamMemberships.personId,
      memberRole: teamMemberships.memberRole,
      firstName: people.firstName,
      lastName: people.lastName,
      preferredName: people.preferredName,
    })
    .from(teamMemberships)
    .innerJoin(people, and(eq(people.id, teamMemberships.personId), isNull(people.archivedAt)))
    .where(and(inArray(teamMemberships.teamId, teamRows.map((t) => t.id)), isNull(teamMemberships.leftOn)))
    .orderBy(asc(people.lastName), asc(people.firstName));
  const [memberRoles, away, manageable] = await Promise.all([
    members.length > 0
      ? db.select().from(teamMemberServingRoles).where(inArray(teamMemberServingRoles.teamMembershipId, members.map((m) => m.membershipId)))
      : Promise.resolve([]),
    members.length > 0
      ? db
          .select({ id: personUnavailability.id, personId: personUnavailability.personId, startsAt: personUnavailability.startsAt, endsAt: personUnavailability.endsAt, reason: personUnavailability.reason })
          .from(personUnavailability)
          .where(and(inArray(personUnavailability.personId, [...new Set(members.map((m) => m.personId))]), gt(personUnavailability.endsAt, ctx.now)))
          .orderBy(asc(personUnavailability.startsAt))
      : Promise.resolve([]),
    manageableTeamIds(db, ctx, teamRows.map((t) => ({ id: t.id, ministryId: t.ministry_id }))),
  ]);

  return teamRows.map((team) => ({
    id: team.id,
    name: team.name,
    ministryId: team.ministry_id,
    ministryName: team.ministry_name,
    canManage: manageable.has(team.id),
    members: members
      .filter((m) => m.teamId === team.id)
      .map((m) => {
        const roles = memberRoles.filter((r) => r.teamMembershipId === m.membershipId);
        return {
          membershipId: m.membershipId,
          personId: m.personId,
          name: displayName(m),
          memberRole: m.memberRole,
          roleIds: roles.map((r) => r.servingRoleId),
          primaryRoleId: roles.find((r) => r.isPrimary)?.servingRoleId ?? null,
          away: away
            .filter((a) => a.personId === m.personId)
            .map((a) => ({ id: a.id, label: awayLabel(a.startsAt, a.endsAt, timeZone), reason: a.reason })),
        };
      }),
  }));
}

export const TeamPeopleSearchInput = z.object({ teamId: z.uuid(), q: z.string().trim().max(80).default('') });

/** People to add to a worship team: names and person codes only, never contact details (docs/06 note j). */
export async function searchPeopleForTeam(db: Database, ctx: RequestContext, raw: unknown) {
  const input = parseInput(TeamPeopleSearchInput, raw);
  const team = await teamForActor(db, ctx, input.teamId);
  if (input.q.length < 2) return [];
  const escaped = input.q.toLowerCase().replace(/[\\%_]/g, (c) => `\\${c}`);
  const rows = await queryRows<{ id: string; first_name: string; last_name: string; preferred_name: string | null; person_code: string }>(
    db,
    sql`SELECT p.id, p.first_name, p.last_name, p.preferred_name, p.person_code
          FROM people p
         WHERE p.archived_at IS NULL AND p.registration_status = 'confirmed'
           AND (p.search_name % lower(immutable_unaccent(${input.q})) OR p.search_name LIKE lower(immutable_unaccent(${`%${escaped}%`})))
           AND NOT EXISTS (SELECT 1 FROM team_memberships tm WHERE tm.team_id = ${team.id}::uuid AND tm.person_id = p.id AND tm.left_on IS NULL)
         ORDER BY p.last_name, p.first_name
         LIMIT 20`,
  );
  return rows.map((r) => ({
    personId: r.id,
    name: displayName({ firstName: r.first_name, lastName: r.last_name, preferredName: r.preferred_name }),
    personCode: r.person_code,
  }));
}

/** Ministries the actor may add worship teams to. */
export async function worshipTeamOptions(db: Executor, ctx: RequestContext) {
  const grants = grantsFor(ctx, 'devotional.teams.manage');
  if (grants.length === 0) return { ministries: [] as { id: string; name: string }[] };
  const global = grants.some((g) => g.scope.type === 'global');
  const ministryIds = new Set(grants.flatMap((g) => (g.scope.type === 'ministry' ? [g.scope.ministryId] : [])));
  const typeIds = grants.flatMap((g) => (g.scope.type === 'gathering_type' ? [g.scope.gatheringTypeId] : []));
  if (typeIds.length > 0) {
    const types = await db.select({ ministryId: gatheringTypes.ministryId }).from(gatheringTypes).where(inArray(gatheringTypes.id, typeIds));
    for (const type of types) if (type.ministryId) ministryIds.add(type.ministryId);
  }
  const rows = await db.select({ id: ministries.id, name: ministries.name }).from(ministries).where(isNull(ministries.archivedAt)).orderBy(asc(ministries.name));
  return { ministries: global ? rows : rows.filter((m) => ministryIds.has(m.id)) };
}

export const CreateWorshipTeamInput = z.object({ ministryId: z.uuid(), name: z.string().trim().min(2, 'Enter a name').max(80) });

export async function createWorshipTeam(db: Database, ctx: RequestContext, raw: unknown) {
  const input = parseInput(CreateWorshipTeamInput, raw);
  const { ministries: allowed } = await worshipTeamOptions(db, ctx);
  if (!allowed.some((m) => m.id === input.ministryId)) throw forbidden('You can add teams only to a ministry you look after.');
  return db.transaction(async (tx) => {
    try {
      const [team] = await tx.insert(teams).values({ ministryId: input.ministryId, name: input.name, teamType: 'worship' }).returning({ id: teams.id });
      await recordAudit(tx, ctx, { category: 'change', action: 'team.created', entityType: 'ministry', entityId: input.ministryId, newValues: { name: input.name, teamType: 'worship' } });
      return { teamId: team!.id };
    } catch (error) {
      if (isUniqueViolation(error)) throw conflict('This ministry already has a team with that name.');
      throw error;
    }
  });
}

export const AddWorshipTeamMemberInput = z.object({
  teamId: z.uuid(),
  personId: z.uuid(),
  memberRole: z.enum(TEAM_MEMBER_ROLES).default('member'),
});

export async function addWorshipTeamMember(db: Database, ctx: RequestContext, raw: unknown) {
  const input = parseInput(AddWorshipTeamMemberInput, raw);
  return db.transaction(async (tx) => {
    const team = await teamForActor(tx, ctx, input.teamId);
    const [person] = await tx.select({ archivedAt: people.archivedAt }).from(people).where(eq(people.id, input.personId));
    if (!person || person.archivedAt) throw notFound('person');
    const today = localDate(ctx.now, await ministryTimeZone(tx));
    try {
      const [membership] = await tx
        .insert(teamMemberships)
        .values({ teamId: team.id, personId: input.personId, memberRole: input.memberRole, joinedOn: today })
        .returning({ id: teamMemberships.id });
      await recordAudit(tx, ctx, {
        category: 'change',
        action: 'team.member_added',
        entityType: 'person',
        entityId: input.personId,
        newValues: { teamId: team.id, memberRole: input.memberRole },
      });
      return { teamMembershipId: membership!.id };
    } catch (error) {
      if (isUniqueViolation(error)) throw conflict('This person is already on that team.');
      throw error;
    }
  });
}

export async function removeWorshipTeamMember(db: Database, ctx: RequestContext, raw: unknown) {
  const { teamMembershipId } = parseInput(z.object({ teamMembershipId: z.uuid() }), raw);
  return db.transaction(async (tx) => {
    const [membership] = await tx
      .select()
      .from(teamMemberships)
      .where(and(eq(teamMemberships.id, teamMembershipId), isNull(teamMemberships.leftOn)))
      .for('update');
    if (!membership) throw notFound('team membership');
    const team = await teamForActor(tx, ctx, membership.teamId);
    const today = localDate(ctx.now, await ministryTimeZone(tx));
    // A member who joined today leaves today; left_on can't be before joined_on.
    await tx
      .update(teamMemberships)
      .set({ leftOn: membership.joinedOn > today ? membership.joinedOn : today })
      .where(eq(teamMemberships.id, membership.id));
    await recordAudit(tx, ctx, { category: 'change', action: 'team.member_ended', entityType: 'person', entityId: membership.personId, oldValues: { teamId: team.id } });
  });
}

/** Replaces a member's default serving roles and their main (primary) role. */
export async function setMemberServingRoles(db: Database, ctx: RequestContext, raw: unknown) {
  const input = parseInput(MemberRolesInput, raw);
  return db.transaction(async (tx) => {
    const [membership] = await tx
      .select()
      .from(teamMemberships)
      .where(and(eq(teamMemberships.id, input.teamMembershipId), isNull(teamMemberships.leftOn)))
      .for('update');
    if (!membership) throw notFound('team membership');
    await teamForActor(tx, ctx, membership.teamId);
    const roleIds = [...new Set(input.servingRoleIds)];
    if (roleIds.length > 0) {
      const found = await tx.select({ id: servingRoles.id }).from(servingRoles).where(and(inArray(servingRoles.id, roleIds), eq(servingRoles.isActive, true)));
      if (found.length !== roleIds.length) throw validationError({ servingRoleIds: ['Choose serving roles that are in use.'] });
    }
    await tx.delete(teamMemberServingRoles).where(eq(teamMemberServingRoles.teamMembershipId, membership.id));
    if (roleIds.length > 0) {
      await tx.insert(teamMemberServingRoles).values(
        roleIds.map((servingRoleId) => ({ teamMembershipId: membership.id, servingRoleId, isPrimary: servingRoleId === input.primaryRoleId })),
      );
    }
    await recordAudit(tx, ctx, {
      category: 'change',
      action: 'devotional.member_roles_set',
      entityType: 'person',
      entityId: membership.personId,
      newValues: { teamId: membership.teamId, roles: roleIds.length, primaryRoleId: input.primaryRoleId ?? null },
    });
    return { roles: roleIds.length };
  });
}
