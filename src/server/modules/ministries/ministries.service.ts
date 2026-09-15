import { and, asc, eq, inArray, isNull, sql } from 'drizzle-orm';
import { z } from 'zod';
import type { RequestContext } from '../../context/request-context';
import type { Database, Executor } from '../../db/client';
import { isUniqueViolation } from '../../db/errors';
import { qualified } from '../../db/sql-helpers';
import { MINISTRY_POSITIONS, TEAM_MEMBER_ROLES, TEAM_TYPES } from '../../db/enums';
import { departments, ministries, ministryMemberships, people, teamMemberships, teams } from '../../db/schema';
import { conflict, notFound, validationError } from '../../errors';
import {
  assertCanAccessPerson,
  assertGlobal,
  assertPermission,
  assertStructureScope,
  grantsFor,
  hasGlobal,
  personScopeFilter,
} from '../../policy/can';
import { parseInput } from '../../validation';
import { recordAudit } from '../audit/audit.service';

/**
 * Ministry service structure: Ministry → Department → Team, and memberships.
 * Deliberately independent of the leadership hierarchy (docs/01 BR-H-07).
 */

const today = (ctx: RequestContext) => ctx.now.toISOString().slice(0, 10);

function ministryIdsInScope(ctx: RequestContext): string[] | 'all' {
  if (hasGlobal(ctx, 'ministries.view')) return 'all';
  return grantsFor(ctx, 'ministries.view').flatMap((g) => (g.scope.type === 'ministry' ? [g.scope.ministryId] : []));
}

// ─── Queries ──────────────────────────────────────────────────────────────────

export async function listMinistries(db: Executor, ctx: RequestContext) {
  assertPermission(ctx, 'ministries.view');
  const scope = ministryIdsInScope(ctx);
  if (scope !== 'all' && scope.length === 0) return [];

  return db
    .select({
      id: ministries.id,
      name: ministries.name,
      code: ministries.code,
      description: ministries.description,
      memberCount: sql<number>`(SELECT count(*)::int FROM ministry_memberships mm WHERE mm.ministry_id = ${qualified(ministries.id)} AND mm.ended_on IS NULL)`,
      departmentCount: sql<number>`(SELECT count(*)::int FROM departments d WHERE d.ministry_id = ${qualified(ministries.id)} AND d.archived_at IS NULL)`,
      teamCount: sql<number>`(SELECT count(*)::int FROM teams t WHERE t.ministry_id = ${qualified(ministries.id)} AND t.archived_at IS NULL)`,
      heads: sql<string | null>`(SELECT string_agg(p.first_name || ' ' || p.last_name, ', ' ORDER BY p.last_name)
        FROM ministry_memberships mm JOIN people p ON p.id = mm.person_id
        WHERE mm.ministry_id = ${qualified(ministries.id)} AND mm.ended_on IS NULL AND mm.position = 'head')`,
    })
    .from(ministries)
    .where(and(isNull(ministries.archivedAt), scope === 'all' ? undefined : inArray(ministries.id, scope)))
    .orderBy(asc(ministries.name));
}

export async function getMinistry(db: Executor, ctx: RequestContext, ministryId: string) {
  assertPermission(ctx, 'ministries.view');
  if (!z.uuid().safeParse(ministryId).success) throw notFound('ministry');
  assertStructureScope(ctx, 'ministries.view', { ministryId });

  const [ministry] = await db
    .select()
    .from(ministries)
    .where(and(eq(ministries.id, ministryId), isNull(ministries.archivedAt)));
  if (!ministry) throw notFound('ministry');

  const [departmentRows, teamRows, members] = await Promise.all([
    db
      .select({ id: departments.id, name: departments.name })
      .from(departments)
      .where(and(eq(departments.ministryId, ministryId), isNull(departments.archivedAt)))
      .orderBy(asc(departments.name)),
    db
      .select({
        id: teams.id,
        name: teams.name,
        teamType: teams.teamType,
        departmentId: teams.departmentId,
        memberCount: sql<number>`(SELECT count(*)::int FROM team_memberships tm WHERE tm.team_id = ${qualified(teams.id)} AND tm.left_on IS NULL)`,
      })
      .from(teams)
      .where(and(eq(teams.ministryId, ministryId), isNull(teams.archivedAt)))
      .orderBy(asc(teams.name)),
    db
      .select({
        membershipId: ministryMemberships.id,
        personId: people.id,
        firstName: people.firstName,
        lastName: people.lastName,
        position: ministryMemberships.position,
        isPrimary: ministryMemberships.isPrimary,
        departmentName: departments.name,
        startedOn: ministryMemberships.startedOn,
      })
      .from(ministryMemberships)
      .innerJoin(people, eq(people.id, ministryMemberships.personId))
      .leftJoin(departments, eq(departments.id, ministryMemberships.departmentId))
      .where(
        and(
          eq(ministryMemberships.ministryId, ministryId),
          isNull(ministryMemberships.endedOn),
          isNull(people.archivedAt),
          personScopeFilter(ctx, 'people.view', people.id),
        ),
      )
      .orderBy(sql`CASE ${ministryMemberships.position} WHEN 'head' THEN 0 WHEN 'assistant_head' THEN 1 ELSE 2 END`, asc(people.lastName)),
  ]);

  return { ministry, departments: departmentRows, teams: teamRows, members };
}

// ─── Structure ────────────────────────────────────────────────────────────────

export const CreateMinistryInput = z.object({
  name: z.string().trim().min(2, 'Enter a name').max(80),
  code: z
    .string()
    .trim()
    .toUpperCase()
    .regex(/^[A-Z0-9-]{2,16}$/, 'Use 2–16 letters, numbers or hyphens'),
  description: z.string().trim().max(500).optional(),
});

export async function createMinistry(db: Database, ctx: RequestContext, raw: unknown) {
  const input = parseInput(CreateMinistryInput, raw);
  assertGlobal(ctx, 'ministries.manage');
  return db.transaction(async (tx) => {
    try {
      const [row] = await tx
        .insert(ministries)
        .values({ name: input.name, code: input.code, description: input.description ?? null })
        .returning({ id: ministries.id });
      await recordAudit(tx, ctx, { category: 'change', action: 'ministry.created', entityType: 'ministry', entityId: row!.id, newValues: input });
      return { ministryId: row!.id };
    } catch (error) {
      if (isUniqueViolation(error)) throw conflict('A ministry with this name or code already exists.');
      throw error;
    }
  });
}

async function assertActiveMinistry(tx: Executor, ministryId: string) {
  const [row] = await tx
    .select({ id: ministries.id })
    .from(ministries)
    .where(and(eq(ministries.id, ministryId), isNull(ministries.archivedAt)));
  if (!row) throw notFound('ministry');
}

export const CreateDepartmentInput = z.object({ ministryId: z.uuid(), name: z.string().trim().min(2, 'Enter a name').max(80) });

export async function createDepartment(db: Database, ctx: RequestContext, raw: unknown) {
  const input = parseInput(CreateDepartmentInput, raw);
  assertStructureScope(ctx, 'ministry.structure.manage', { ministryId: input.ministryId });
  return db.transaction(async (tx) => {
    await assertActiveMinistry(tx, input.ministryId);
    try {
      const [row] = await tx.insert(departments).values(input).returning({ id: departments.id });
      await recordAudit(tx, ctx, { category: 'change', action: 'department.created', entityType: 'ministry', entityId: input.ministryId, newValues: { name: input.name } });
      return { departmentId: row!.id };
    } catch (error) {
      if (isUniqueViolation(error)) throw conflict('This ministry already has a department with that name.');
      throw error;
    }
  });
}

export const CreateTeamInput = z.object({
  ministryId: z.uuid(),
  departmentId: z.preprocess((v) => (v === '' ? undefined : v), z.uuid().optional()),
  name: z.string().trim().min(2, 'Enter a name').max(80),
  teamType: z.enum(TEAM_TYPES).default('general'),
});

export async function createTeam(db: Database, ctx: RequestContext, raw: unknown) {
  const input = parseInput(CreateTeamInput, raw);
  assertStructureScope(ctx, 'ministry.structure.manage', { ministryId: input.ministryId });
  return db.transaction(async (tx) => {
    await assertActiveMinistry(tx, input.ministryId);
    if (input.departmentId) {
      const [dept] = await tx
        .select({ id: departments.id })
        .from(departments)
        .where(and(eq(departments.id, input.departmentId), eq(departments.ministryId, input.ministryId)));
      if (!dept) throw validationError({ departmentId: ['Choose a department from this ministry.'] });
    }
    try {
      const [row] = await tx
        .insert(teams)
        .values({ ministryId: input.ministryId, departmentId: input.departmentId ?? null, name: input.name, teamType: input.teamType })
        .returning({ id: teams.id });
      await recordAudit(tx, ctx, { category: 'change', action: 'team.created', entityType: 'ministry', entityId: input.ministryId, newValues: { name: input.name, teamType: input.teamType } });
      return { teamId: row!.id };
    } catch (error) {
      if (isUniqueViolation(error)) throw conflict('This ministry already has a team with that name.');
      throw error;
    }
  });
}

// ─── Memberships ──────────────────────────────────────────────────────────────

export const AddMinistryMemberInput = z.object({
  personId: z.uuid(),
  ministryId: z.uuid(),
  departmentId: z.preprocess((v) => (v === '' ? undefined : v), z.uuid().optional()),
  position: z.enum(MINISTRY_POSITIONS).default('member'),
  isPrimary: z.boolean().default(false),
});

export async function addMinistryMember(db: Database, ctx: RequestContext, raw: unknown) {
  const input = parseInput(AddMinistryMemberInput, raw);
  assertStructureScope(ctx, 'ministry.members.manage', { ministryId: input.ministryId });
  return db.transaction(async (tx) => {
    await assertCanAccessPerson(tx, ctx, 'people.view', input.personId);
    await assertActiveMinistry(tx, input.ministryId);
    if (input.departmentId) {
      const [dept] = await tx
        .select({ id: departments.id })
        .from(departments)
        .where(and(eq(departments.id, input.departmentId), eq(departments.ministryId, input.ministryId)));
      if (!dept) throw validationError({ departmentId: ['Choose a department from this ministry.'] });
    }
    if (input.isPrimary) {
      await tx
        .update(ministryMemberships)
        .set({ isPrimary: false, updatedAt: ctx.now })
        .where(and(eq(ministryMemberships.personId, input.personId), isNull(ministryMemberships.endedOn)));
    }
    try {
      const [row] = await tx
        .insert(ministryMemberships)
        .values({
          personId: input.personId,
          ministryId: input.ministryId,
          departmentId: input.departmentId ?? null,
          position: input.position,
          isPrimary: input.isPrimary,
          startedOn: today(ctx),
        })
        .returning({ id: ministryMemberships.id });
      await recordAudit(tx, ctx, {
        category: 'change',
        action: 'ministry.member_added',
        entityType: 'person',
        entityId: input.personId,
        newValues: { ministryId: input.ministryId, position: input.position, isPrimary: input.isPrimary },
      });
      return { membershipId: row!.id };
    } catch (error) {
      if (isUniqueViolation(error)) throw conflict('This person is already serving in that ministry.');
      throw error;
    }
  });
}

export const EndMembershipInput = z.object({ membershipId: z.uuid() });

export async function endMinistryMembership(db: Database, ctx: RequestContext, raw: unknown) {
  const input = parseInput(EndMembershipInput, raw);
  assertPermission(ctx, 'ministry.members.manage');
  return db.transaction(async (tx) => {
    const [membership] = await tx
      .select()
      .from(ministryMemberships)
      .where(and(eq(ministryMemberships.id, input.membershipId), isNull(ministryMemberships.endedOn)));
    if (!membership) throw notFound('membership');
    assertStructureScope(ctx, 'ministry.members.manage', { ministryId: membership.ministryId });
    await tx
      .update(ministryMemberships)
      .set({ endedOn: today(ctx), isPrimary: false, updatedAt: ctx.now })
      .where(eq(ministryMemberships.id, membership.id));
    await recordAudit(tx, ctx, {
      category: 'change',
      action: 'ministry.member_ended',
      entityType: 'person',
      entityId: membership.personId,
      oldValues: { ministryId: membership.ministryId, position: membership.position },
    });
  });
}

export const AddTeamMemberInput = z.object({
  teamId: z.uuid(),
  personId: z.uuid(),
  memberRole: z.enum(TEAM_MEMBER_ROLES).default('member'),
});

export async function addTeamMember(db: Database, ctx: RequestContext, raw: unknown) {
  const input = parseInput(AddTeamMemberInput, raw);
  assertPermission(ctx, 'ministry.members.manage');
  return db.transaction(async (tx) => {
    const [team] = await tx
      .select({ id: teams.id, ministryId: teams.ministryId })
      .from(teams)
      .where(and(eq(teams.id, input.teamId), isNull(teams.archivedAt)));
    if (!team) throw notFound('team');
    assertStructureScope(ctx, 'ministry.members.manage', { ministryId: team.ministryId, teamId: team.id });
    await assertCanAccessPerson(tx, ctx, 'people.view', input.personId);
    try {
      const [row] = await tx
        .insert(teamMemberships)
        .values({ teamId: team.id, personId: input.personId, memberRole: input.memberRole, joinedOn: today(ctx) })
        .returning({ id: teamMemberships.id });
      await recordAudit(tx, ctx, {
        category: 'change',
        action: 'team.member_added',
        entityType: 'person',
        entityId: input.personId,
        newValues: { teamId: team.id, memberRole: input.memberRole },
      });
      return { teamMembershipId: row!.id };
    } catch (error) {
      if (isUniqueViolation(error)) throw conflict('This person is already on that team.');
      throw error;
    }
  });
}

export async function endTeamMembership(db: Database, ctx: RequestContext, raw: unknown) {
  const input = parseInput(z.object({ teamMembershipId: z.uuid() }), raw);
  assertPermission(ctx, 'ministry.members.manage');
  return db.transaction(async (tx) => {
    const [row] = await tx
      .select({ id: teamMemberships.id, personId: teamMemberships.personId, teamId: teams.id, ministryId: teams.ministryId })
      .from(teamMemberships)
      .innerJoin(teams, eq(teams.id, teamMemberships.teamId))
      .where(and(eq(teamMemberships.id, input.teamMembershipId), isNull(teamMemberships.leftOn)));
    if (!row) throw notFound('team membership');
    assertStructureScope(ctx, 'ministry.members.manage', { ministryId: row.ministryId, teamId: row.teamId });
    await tx.update(teamMemberships).set({ leftOn: today(ctx) }).where(eq(teamMemberships.id, row.id));
    await recordAudit(tx, ctx, { category: 'change', action: 'team.member_ended', entityType: 'person', entityId: row.personId, oldValues: { teamId: row.teamId } });
  });
}

/** Ministries (with departments and teams) the actor may assign people to, for forms. */
export async function listAssignableMinistries(db: Executor, ctx: RequestContext) {
  const grants = grantsFor(ctx, 'ministry.members.manage');
  if (grants.length === 0) return [];
  const all = grants.some((g) => g.scope.type === 'global');
  const ids = grants.flatMap((g) => (g.scope.type === 'ministry' ? [g.scope.ministryId] : []));
  if (!all && ids.length === 0) return [];

  const rows = await db
    .select({ id: ministries.id, name: ministries.name })
    .from(ministries)
    .where(and(isNull(ministries.archivedAt), all ? undefined : inArray(ministries.id, ids)))
    .orderBy(asc(ministries.name));
  if (rows.length === 0) return [];
  const [deptRows, teamRows] = await Promise.all([
    db
      .select({ id: departments.id, name: departments.name, ministryId: departments.ministryId })
      .from(departments)
      .where(and(isNull(departments.archivedAt), inArray(departments.ministryId, rows.map((r) => r.id))))
      .orderBy(asc(departments.name)),
    db
      .select({ id: teams.id, name: teams.name, ministryId: teams.ministryId })
      .from(teams)
      .where(and(isNull(teams.archivedAt), inArray(teams.ministryId, rows.map((r) => r.id))))
      .orderBy(asc(teams.name)),
  ]);
  return rows.map((m) => ({
    ...m,
    departments: deptRows.filter((d) => d.ministryId === m.id),
    teams: teamRows.filter((t) => t.ministryId === m.id),
  }));
}
