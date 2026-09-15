import { and, asc, count, desc, eq, gt, inArray, isNotNull, isNull, sql, type SQL } from 'drizzle-orm';
import { alias } from 'drizzle-orm/pg-core';
import { z } from 'zod';
import { normalizeCode } from '@/lib/ids';
import { formatPhone, looksLikePhone, normalizePhone } from '@/lib/phone';
import type { RequestContext } from '../../context/request-context';
import type { Executor } from '../../db/client';
import {
  auditLogs,
  departments,
  designationTypes,
  hierarchyClosure,
  hierarchyNodes,
  leaderChangeRequests,
  leadershipHistory,
  leadershipLevels,
  ministries,
  ministryMemberships,
  people,
  personDesignations,
  personDuplicateCandidates,
  roles,
  teamMemberships,
  teams,
  userRoleAssignments,
  users,
} from '../../db/schema';
import { notFound } from '../../errors';
import { assertCanAccessPerson, assertPermission, canAccessPerson, hasGlobal, hasPermission, personScopeFilter } from '../../policy/can';
import { parseInput } from '../../validation';
import { getSetting } from '../settings/settings.service';
import { PeopleFilters } from './people.schemas';

export const displayName = (p: { firstName: string; lastName: string; preferredName?: string | null }) =>
  p.preferredName && p.preferredName !== p.firstName
    ? `${p.firstName} (${p.preferredName}) ${p.lastName}`
    : `${p.firstName} ${p.lastName}`;

const shortName = (first: string | null, last: string | null) => (first && last ? `${first} ${last}` : null);

// ─── Directory search ─────────────────────────────────────────────────────────

export interface PersonListItem {
  id: string;
  personCode: string;
  name: string;
  status: 'active' | 'inactive';
  registrationStatus: string;
  archivedAt: Date | null;
  phone: string | null;
  leader: { id: string; name: string } | null;
  primaryLeader: { id: string; name: string } | null;
  depth: number | null;
  levelName: string | null;
  ministryName: string | null;
}

/**
 * WHERE and ORDER BY of the people directory (people LEFT JOIN hierarchy_nodes), shared by
 * the directory page and the CSV export so both always apply the same filters and scope.
 */
export function peopleDirectoryQuery(
  ctx: RequestContext,
  f: z.infer<typeof PeopleFilters>,
  defaultCountry: Parameters<typeof normalizePhone>[1],
) {
  const contactVisible = personScopeFilter(ctx, 'people.contact.view', people.id);

  const conditions: SQL[] = [
    personScopeFilter(ctx, 'people.view', people.id),
    f.archived ? isNotNull(people.archivedAt) : isNull(people.archivedAt),
  ];
  if (f.status) conditions.push(eq(people.status, f.status));
  if (f.registration) conditions.push(eq(people.registrationStatus, f.registration));
  if (f.leaderId) conditions.push(eq(hierarchyNodes.parentPersonId, f.leaderId));
  if (f.primaryLeaderId) conditions.push(eq(hierarchyNodes.primaryLeaderPersonId, f.primaryLeaderId));
  if (f.depth !== undefined) conditions.push(eq(hierarchyNodes.depth, f.depth));
  if (f.placement === 'placed') conditions.push(isNotNull(hierarchyNodes.personId));
  if (f.placement === 'unplaced') conditions.push(isNull(hierarchyNodes.personId));
  if (f.ministryId) {
    conditions.push(sql`EXISTS (SELECT 1 FROM ministry_memberships mm
      WHERE mm.person_id = ${people.id} AND mm.ministry_id = ${f.ministryId} AND mm.ended_on IS NULL)`);
  }
  if (f.teamId) {
    conditions.push(sql`EXISTS (SELECT 1 FROM team_memberships tm
      WHERE tm.person_id = ${people.id} AND tm.team_id = ${f.teamId} AND tm.left_on IS NULL)`);
  }
  if (f.designation) {
    conditions.push(sql`EXISTS (SELECT 1 FROM person_designations pd
      WHERE pd.person_id = ${people.id} AND pd.designation_key = ${f.designation} AND pd.ended_on IS NULL)`);
  }

  let rank: SQL | null = null;
  if (f.q) {
    if (/^P-?[0-9A-Za-z]{6}$/.test(f.q)) {
      conditions.push(eq(people.personCode, `P-${normalizeCode(f.q).slice(1)}`));
    } else if (looksLikePhone(f.q)) {
      // Searching by phone is only possible for people whose contact details you may see.
      const phone = normalizePhone(f.q, defaultCountry);
      conditions.push(phone.ok ? and(eq(people.phoneE164, phone.e164), contactVisible)! : sql`FALSE`);
    } else {
      const escaped = f.q.toLowerCase().replace(/[\\%_]/g, (c) => `\\${c}`);
      conditions.push(sql`(${people.searchName} % lower(immutable_unaccent(${f.q}))
        OR ${people.searchName} LIKE lower(immutable_unaccent(${`%${escaped}%`})))`);
      rank = sql`similarity(${people.searchName}, lower(immutable_unaccent(${f.q})))`;
    }
  }

  const where = and(...conditions);
  const orderBy = rank
    ? [desc(rank), asc(people.lastName), asc(people.firstName)]
    : f.sort === 'joined'
      ? [sql`${people.joinedOn} DESC NULLS LAST`, asc(people.lastName)]
      : f.sort === 'updated'
        ? [desc(people.updatedAt)]
        : [asc(people.lastName), asc(people.firstName), asc(people.id)];

  return { where, orderBy, contactVisible };
}

export async function searchPeople(db: Executor, ctx: RequestContext, raw: unknown) {
  const f = parseInput(PeopleFilters, raw);
  assertPermission(ctx, 'people.view');
  const { defaultCountry } = await getSetting(db, 'ministry.profile');
  const leader = alias(people, 'leader');
  const primary = alias(people, 'primary_leader');
  const { where, orderBy, contactVisible } = peopleDirectoryQuery(ctx, f, defaultCountry);

  const [rows, [totalRow]] = await Promise.all([
    db
      .select({
        id: people.id,
        personCode: people.personCode,
        firstName: people.firstName,
        lastName: people.lastName,
        preferredName: people.preferredName,
        status: people.status,
        registrationStatus: people.registrationStatus,
        archivedAt: people.archivedAt,
        phoneE164: sql<string | null>`CASE WHEN ${contactVisible} THEN ${people.phoneE164} END`,
        leaderId: leader.id,
        leaderFirst: leader.firstName,
        leaderLast: leader.lastName,
        primaryId: primary.id,
        primaryFirst: primary.firstName,
        primaryLast: primary.lastName,
        depth: hierarchyNodes.depth,
        levelName: leadershipLevels.name,
        ministryName: sql<string | null>`(SELECT m.name FROM ministry_memberships mm
          JOIN ministries m ON m.id = mm.ministry_id
          WHERE mm.person_id = ${people.id} AND mm.ended_on IS NULL
          ORDER BY mm.is_primary DESC, mm.started_on LIMIT 1)`,
      })
      .from(people)
      .leftJoin(hierarchyNodes, eq(hierarchyNodes.personId, people.id))
      .leftJoin(leader, eq(leader.id, hierarchyNodes.parentPersonId))
      .leftJoin(primary, eq(primary.id, hierarchyNodes.primaryLeaderPersonId))
      .leftJoin(leadershipLevels, eq(leadershipLevels.depth, hierarchyNodes.depth))
      .where(where)
      .orderBy(...orderBy)
      .limit(f.pageSize)
      .offset((f.page - 1) * f.pageSize),
    db
      .select({ total: count() })
      .from(people)
      .leftJoin(hierarchyNodes, eq(hierarchyNodes.personId, people.id))
      .where(where),
  ]);

  const items: PersonListItem[] = rows.map((r) => ({
    id: r.id,
    personCode: r.personCode,
    name: displayName(r),
    status: r.status,
    registrationStatus: r.registrationStatus,
    archivedAt: r.archivedAt,
    phone: r.phoneE164 ? formatPhone(r.phoneE164, defaultCountry) : null,
    leader: r.leaderId ? { id: r.leaderId, name: shortName(r.leaderFirst, r.leaderLast)! } : null,
    primaryLeader: r.primaryId && r.primaryId !== r.id ? { id: r.primaryId, name: shortName(r.primaryFirst, r.primaryLast)! } : null,
    depth: r.depth,
    levelName: r.levelName,
    ministryName: r.ministryName,
  }));
  return { items, total: totalRow?.total ?? 0, page: f.page, pageSize: f.pageSize, filters: f };
}

// ─── Picker (leader / person selectors) ───────────────────────────────────────

export interface PersonOption {
  id: string;
  name: string;
  personCode: string;
  hint: string | null;
}

export type PickerMode = 'people.view' | 'people.create' | 'hierarchy.manage' | 'leader_directory';

/** Name of one person, only if the actor holds `permission` over them (for form defaults). */
export async function getPersonName(
  db: Executor,
  ctx: RequestContext,
  personId: string,
  permission: 'people.view' | 'people.create' | 'hierarchy.manage',
): Promise<{ id: string; name: string } | null> {
  if (!z.uuid().safeParse(personId).success) return null;
  if (!(await canAccessPerson(db, ctx, permission, personId))) return null;
  const [row] = await db
    .select({ id: people.id, firstName: people.firstName, lastName: people.lastName, preferredName: people.preferredName })
    .from(people)
    .where(and(eq(people.id, personId), isNull(people.archivedAt)));
  return row ? { id: row.id, name: displayName(row) } : null;
}

export async function searchPeopleForPicker(
  db: Executor,
  ctx: RequestContext,
  raw: { q?: string; placedOnly?: boolean; permission?: PickerMode },
): Promise<PersonOption[]> {
  const input = z
    .object({
      q: z.string().trim().min(2).max(60),
      placedOnly: z.boolean().default(false),
      permission: z.enum(['people.view', 'people.create', 'hierarchy.manage', 'leader_directory']).default('people.view'),
    })
    .safeParse(raw);
  if (!input.success) return [];
  // The leader directory lists leaders who accept members, by name, to anyone who can view people
  // (the same information the public leader selector shows, docs/01 FR-JRN-05).
  const required = input.data.permission === 'leader_directory' ? 'people.view' : input.data.permission;
  if (!hasPermission(ctx, required)) return [];
  const { q, placedOnly, permission } = input.data;
  const leader = alias(people, 'leader');

  const codeMatch = /^P-?[0-9A-Za-z]{6}$/.test(q);
  const rows = await db
    .select({
      id: people.id,
      personCode: people.personCode,
      firstName: people.firstName,
      lastName: people.lastName,
      preferredName: people.preferredName,
      leaderFirst: leader.firstName,
      leaderLast: leader.lastName,
    })
    .from(people)
    .leftJoin(hierarchyNodes, eq(hierarchyNodes.personId, people.id))
    .leftJoin(leader, eq(leader.id, hierarchyNodes.parentPersonId))
    .where(
      and(
        isNull(people.archivedAt),
        permission === 'leader_directory'
          ? and(isNotNull(hierarchyNodes.personId), eq(hierarchyNodes.acceptsMembers, true))
          : personScopeFilter(ctx, permission, people.id),
        placedOnly ? isNotNull(hierarchyNodes.personId) : undefined,
        codeMatch
          ? eq(people.personCode, `P-${normalizeCode(q).slice(1)}`)
          : sql`(${people.searchName} % lower(immutable_unaccent(${q}))
                 OR ${people.searchName} LIKE lower(immutable_unaccent(${`%${q.toLowerCase().replace(/[\\%_]/g, (c) => `\\${c}`)}%`})))`,
      ),
    )
    .orderBy(codeMatch ? asc(people.lastName) : desc(sql`similarity(${people.searchName}, lower(immutable_unaccent(${q})))`))
    .limit(8);

  return rows.map((r) => ({
    id: r.id,
    name: displayName(r),
    personCode: r.personCode,
    hint: r.leaderFirst ? `Leader: ${r.leaderFirst} ${r.leaderLast}` : null,
  }));
}

// ─── Profile ──────────────────────────────────────────────────────────────────

export async function getPersonDetail(db: Executor, ctx: RequestContext, personId: string) {
  assertPermission(ctx, 'people.view');
  if (!z.uuid().safeParse(personId).success) throw notFound('person');
  await assertCanAccessPerson(db, ctx, 'people.view', personId);

  const [person] = await db.select().from(people).where(eq(people.id, personId));
  if (!person) throw notFound('person');
  const { defaultCountry, timezone } = await getSetting(db, 'ministry.profile');

  const [contactVisible, canEdit, canEditContact, canMove, canAddToGroup, canSeeEntityAudit] = await Promise.all([
    canAccessPerson(db, ctx, 'people.contact.view', personId),
    canAccessPerson(db, ctx, 'people.edit', personId),
    canAccessPerson(db, ctx, 'people.contact.edit', personId),
    canAccessPerson(db, ctx, 'hierarchy.manage', personId),
    canAccessPerson(db, ctx, 'people.create', personId),
    canAccessPerson(db, ctx, 'audit.view.entity', personId),
  ]);

  const [node] = await db
    .select({
      depth: hierarchyNodes.depth,
      parentPersonId: hierarchyNodes.parentPersonId,
      primaryLeaderPersonId: hierarchyNodes.primaryLeaderPersonId,
      acceptsMembers: hierarchyNodes.acceptsMembers,
      levelName: leadershipLevels.name,
    })
    .from(hierarchyNodes)
    .leftJoin(leadershipLevels, eq(leadershipLevels.depth, hierarchyNodes.depth))
    .where(eq(hierarchyNodes.personId, personId));

  const [chain, group, sizes, designations, memberships, teamRows, pendingRequest, history] = await Promise.all([
    // Chain of leadership, from the top down to the direct leader.
    db
      .select({
        id: people.id,
        firstName: people.firstName,
        lastName: people.lastName,
        preferredName: people.preferredName,
        viewable: sql<boolean>`${personScopeFilter(ctx, 'people.view', people.id)}`,
      })
      .from(hierarchyClosure)
      .innerJoin(people, eq(people.id, hierarchyClosure.ancestorId))
      .where(and(eq(hierarchyClosure.descendantId, personId), gt(hierarchyClosure.depth, 0)))
      .orderBy(desc(hierarchyClosure.depth)),
    // Direct group, limited to people the viewer may see.
    db
      .select({
        id: people.id,
        firstName: people.firstName,
        lastName: people.lastName,
        preferredName: people.preferredName,
        status: people.status,
        groupSize: sql<number>`(SELECT count(*)::int FROM hierarchy_nodes c WHERE c.parent_person_id = ${people.id})`,
      })
      .from(hierarchyNodes)
      .innerJoin(people, eq(people.id, hierarchyNodes.personId))
      .where(and(eq(hierarchyNodes.parentPersonId, personId), personScopeFilter(ctx, 'people.view', people.id)))
      .orderBy(asc(people.lastName), asc(people.firstName)),
    db
      .select({
        direct: sql<number>`(SELECT count(*)::int FROM hierarchy_nodes WHERE parent_person_id = ${personId})`,
        branch: sql<number>`(SELECT greatest(count(*) - 1, 0)::int FROM hierarchy_closure WHERE ancestor_id = ${personId})`,
      })
      .from(sql`(SELECT 1) AS one`),
    db
      .select({ key: personDesignations.designationKey, name: designationTypes.name })
      .from(personDesignations)
      .innerJoin(designationTypes, eq(designationTypes.key, personDesignations.designationKey))
      .where(and(eq(personDesignations.personId, personId), isNull(personDesignations.endedOn)))
      .orderBy(asc(designationTypes.sortOrder)),
    db
      .select({
        id: ministryMemberships.id,
        ministryId: ministries.id,
        ministryName: ministries.name,
        departmentName: departments.name,
        position: ministryMemberships.position,
        isPrimary: ministryMemberships.isPrimary,
      })
      .from(ministryMemberships)
      .innerJoin(ministries, eq(ministries.id, ministryMemberships.ministryId))
      .leftJoin(departments, eq(departments.id, ministryMemberships.departmentId))
      .where(and(eq(ministryMemberships.personId, personId), isNull(ministryMemberships.endedOn)))
      .orderBy(desc(ministryMemberships.isPrimary), asc(ministries.name)),
    db
      .select({ id: teamMemberships.id, teamId: teams.id, teamName: teams.name, ministryName: ministries.name, memberRole: teamMemberships.memberRole })
      .from(teamMemberships)
      .innerJoin(teams, eq(teams.id, teamMemberships.teamId))
      .innerJoin(ministries, eq(ministries.id, teams.ministryId))
      .where(and(eq(teamMemberships.personId, personId), isNull(teamMemberships.leftOn)))
      .orderBy(asc(teams.name)),
    db
      .select({ id: leaderChangeRequests.id, toLeaderPersonId: leaderChangeRequests.toLeaderPersonId, createdAt: leaderChangeRequests.createdAt })
      .from(leaderChangeRequests)
      .where(and(eq(leaderChangeRequests.personId, personId), eq(leaderChangeRequests.status, 'pending'))),
    db
      .select({
        changeType: leadershipHistory.changeType,
        effectiveAt: leadershipHistory.effectiveAt,
        reason: leadershipHistory.reason,
        previousLeaderId: leadershipHistory.previousLeaderPersonId,
        newLeaderId: leadershipHistory.newLeaderPersonId,
      })
      .from(leadershipHistory)
      .where(eq(leadershipHistory.personId, personId))
      .orderBy(desc(leadershipHistory.effectiveAt))
      .limit(10),
  ]);

  // Names for leaders mentioned in history / requests.
  const referencedIds = [
    ...new Set(
      [...history.flatMap((h) => [h.previousLeaderId, h.newLeaderId]), pendingRequest[0]?.toLeaderPersonId].filter(
        (id): id is string => Boolean(id),
      ),
    ),
  ];
  const referenced = referencedIds.length
    ? await db.select({ id: people.id, firstName: people.firstName, lastName: people.lastName }).from(people).where(inArray(people.id, referencedIds))
    : [];
  const nameOf = (id: string | null) => {
    const p = id ? referenced.find((r) => r.id === id) : undefined;
    return p ? `${p.firstName} ${p.lastName}` : null;
  };

  let account: { userId: string; status: string; roles: { assignmentId: string; roleKey: string; roleName: string; scopeType: string; branchMaxDepth: number | null }[] } | null = null;
  if (hasGlobal(ctx, 'iam.users.view')) {
    const [user] = await db.select({ id: users.id, status: users.status }).from(users).where(eq(users.personId, personId));
    if (user) {
      const assignments = await db
        .select({
          assignmentId: userRoleAssignments.id,
          roleKey: roles.key,
          roleName: roles.name,
          scopeType: userRoleAssignments.scopeType,
          branchMaxDepth: userRoleAssignments.branchMaxDepth,
        })
        .from(userRoleAssignments)
        .innerJoin(roles, eq(roles.id, userRoleAssignments.roleId))
        .where(and(eq(userRoleAssignments.userId, user.id), isNull(userRoleAssignments.revokedAt)));
      account = { userId: user.id, status: user.status, roles: assignments };
    }
  }

  const audit =
    canSeeEntityAudit || hasGlobal(ctx, 'audit.view')
      ? await db
          .select({ action: auditLogs.action, occurredAt: auditLogs.occurredAt, actorName: users.name, reason: auditLogs.reason })
          .from(auditLogs)
          .leftJoin(users, eq(users.id, auditLogs.actorUserId))
          .where(and(eq(auditLogs.entityType, 'person'), eq(auditLogs.entityId, personId)))
          .orderBy(desc(auditLogs.occurredAt))
          .limit(15)
      : null;

  const leaderLink = chain.at(-1);
  const primaryLink = node?.primaryLeaderPersonId && node.primaryLeaderPersonId !== personId
    ? chain.find((c) => c.id === node.primaryLeaderPersonId)
    : undefined;

  return {
    timezone,
    person: {
      id: person.id,
      personCode: person.personCode,
      name: displayName(person),
      firstName: person.firstName,
      lastName: person.lastName,
      preferredName: person.preferredName,
      status: person.status,
      registrationStatus: person.registrationStatus,
      source: person.source,
      joinedOn: person.joinedOn,
      journalExpected: person.journalExpected,
      archivedAt: person.archivedAt,
      archivedReason: person.archivedReason,
      createdAt: person.createdAt,
      updatedAt: person.updatedAt,
    },
    contact: contactVisible
      ? {
          phone: person.phoneE164 ? formatPhone(person.phoneE164, defaultCountry) : null,
          phoneE164: person.phoneE164,
          email: person.email,
          birthday: person.birthMonth
            ? { month: person.birthMonth, day: person.birthDay, year: person.birthYear }
            : null,
          address: [person.addressLine, person.city, person.province].filter(Boolean).join(', ') || null,
        }
      : null,
    leadership: node
      ? {
          depth: node.depth,
          levelName: node.levelName,
          acceptsMembers: node.acceptsMembers,
          leader: leaderLink ? { id: leaderLink.id, name: displayName(leaderLink), viewable: leaderLink.viewable } : null,
          primaryLeader: primaryLink ? { id: primaryLink.id, name: displayName(primaryLink), viewable: primaryLink.viewable } : null,
          chain: chain.map((c) => ({ id: c.id, name: displayName(c), viewable: c.viewable })),
          directCount: sizes[0]?.direct ?? 0,
          branchSize: sizes[0]?.branch ?? 0,
          group: group.map((g) => ({ id: g.id, name: displayName(g), status: g.status, groupSize: g.groupSize })),
        }
      : null,
    designations,
    memberships,
    teams: teamRows,
    pendingRequest: pendingRequest[0]
      ? { id: pendingRequest[0].id, toLeaderName: nameOf(pendingRequest[0].toLeaderPersonId), createdAt: pendingRequest[0].createdAt }
      : null,
    history: history.map((h) => ({ ...h, previousLeaderName: nameOf(h.previousLeaderId), newLeaderName: nameOf(h.newLeaderId) })),
    account,
    audit,
    can: {
      edit: canEdit && !person.archivedAt,
      editContact: canEditContact && !person.archivedAt,
      move: canMove && !person.archivedAt,
      addToGroup: canAddToGroup && Boolean(node) && !person.archivedAt,
      archive: hasGlobal(ctx, 'people.archive') && !person.archivedAt,
      manageAccess: hasGlobal(ctx, 'iam.users.manage') && !person.archivedAt,
      manageMinistries: hasPermission(ctx, 'ministry.members.manage') && !person.archivedAt,
    },
  };
}

export type PersonDetail = Awaited<ReturnType<typeof getPersonDetail>>;

/** Raw values for the edit form (contact fields only when the viewer may see them). */
export async function getPersonForEdit(db: Executor, ctx: RequestContext, personId: string) {
  assertPermission(ctx, 'people.edit');
  if (!z.uuid().safeParse(personId).success) throw notFound('person');
  await assertCanAccessPerson(db, ctx, 'people.edit', personId);
  const [person] = await db.select().from(people).where(and(eq(people.id, personId), isNull(people.archivedAt)));
  if (!person) throw notFound('person');
  const contactVisible = await canAccessPerson(db, ctx, 'people.contact.view', personId);
  const canEditContact = await canAccessPerson(db, ctx, 'people.contact.edit', personId);
  const designations = await db
    .select({ key: personDesignations.designationKey })
    .from(personDesignations)
    .where(and(eq(personDesignations.personId, personId), isNull(personDesignations.endedOn)));
  const { defaultCountry } = await getSetting(db, 'ministry.profile');

  return {
    id: person.id,
    updatedAt: person.updatedAt.toISOString(),
    firstName: person.firstName,
    lastName: person.lastName,
    middleName: person.middleName,
    suffix: person.suffix,
    preferredName: person.preferredName,
    gender: person.gender,
    joinedOn: person.joinedOn,
    status: person.status,
    journalExpected: person.journalExpected,
    designations: designations.map((d) => d.key),
    contact: contactVisible
      ? {
          phone: person.phoneE164 ? formatPhone(person.phoneE164, defaultCountry) : '',
          email: person.email ?? '',
          birthMonth: person.birthMonth,
          birthDay: person.birthDay,
          birthYear: person.birthYear,
          addressLine: person.addressLine ?? '',
          city: person.city ?? '',
          province: person.province ?? '',
        }
      : null,
    canEditContact,
  };
}

/** Open duplicate candidates for the review queue (docs/04 A6). */
export async function listDuplicateCandidates(db: Executor, ctx: RequestContext) {
  if (!hasGlobal(ctx, 'people.merge')) throw notFound('page');
  const a = alias(people, 'person_a');
  const b = alias(people, 'person_b');
  const { defaultCountry } = await getSetting(db, 'ministry.profile');
  const personFields = <T extends typeof a | typeof b>(p: T) => ({
    id: p.id,
    personCode: p.personCode,
    firstName: p.firstName,
    lastName: p.lastName,
    preferredName: p.preferredName,
    phoneE164: p.phoneE164,
    email: p.email,
    archivedAt: p.archivedAt,
  });
  const rows = await db
    .select({
      id: personDuplicateCandidates.id,
      reasons: personDuplicateCandidates.reasons,
      score: personDuplicateCandidates.score,
      createdAt: personDuplicateCandidates.createdAt,
      a: personFields(a),
      b: personFields(b),
    })
    .from(personDuplicateCandidates)
    .innerJoin(a, eq(a.id, personDuplicateCandidates.personAId))
    .innerJoin(b, eq(b.id, personDuplicateCandidates.personBId))
    .where(eq(personDuplicateCandidates.status, 'open'))
    .orderBy(desc(personDuplicateCandidates.score), desc(personDuplicateCandidates.createdAt))
    .limit(100);

  const format = (p: (typeof rows)[number]['a']) => ({
    id: p.id,
    personCode: p.personCode,
    name: displayName(p),
    phone: p.phoneE164 ? formatPhone(p.phoneE164, defaultCountry) : null,
    email: p.email,
    archived: Boolean(p.archivedAt),
  });
  return rows
    .filter((r) => !r.a.archivedAt && !r.b.archivedAt)
    .map((r) => ({ id: r.id, reasons: r.reasons, score: Number(r.score), createdAt: r.createdAt, a: format(r.a), b: format(r.b) }));
}

export async function listDesignationTypes(db: Executor) {
  return db.select({ key: designationTypes.key, name: designationTypes.name }).from(designationTypes).orderBy(asc(designationTypes.sortOrder));
}
