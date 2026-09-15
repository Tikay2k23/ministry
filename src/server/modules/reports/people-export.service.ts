import { and, eq, sql } from 'drizzle-orm';
import { alias } from 'drizzle-orm/pg-core';
import { formatPhone } from '@/lib/phone';
import type { RequestContext } from '../../context/request-context';
import type { Database } from '../../db/client';
import { hierarchyNodes, leadershipLevels, people } from '../../db/schema';
import { assertPermission, personScopeFilter } from '../../policy/can';
import { parseInput } from '../../validation';
import { recordAudit } from '../audit/audit.service';
import { peopleDirectoryQuery } from '../people/people.queries';
import { PeopleFilters } from '../people/people.schemas';
import { getSetting } from '../settings/settings.service';
import { csvFilename, toCsv } from './csv';

/**
 * People directory CSV (docs/01 FR-RPT-04). Same filters and scope as the directory page,
 * narrowed further to people the actor may export. Mobile and email are filled only where the
 * actor may see contact details. Every export is audited.
 */

const MAX_EXPORT_ROWS = 20_000;

const STATUS_LABEL: Record<string, string> = { active: 'Active', inactive: 'Inactive' };
const REGISTRATION_LABEL: Record<string, string> = { confirmed: 'Confirmed', unconfirmed: 'Unconfirmed', rejected: 'Declined' };

export async function exportPeopleDirectory(db: Database, ctx: RequestContext, raw: unknown) {
  assertPermission(ctx, 'people.view');
  assertPermission(ctx, 'people.export');
  const filters = parseInput(PeopleFilters, raw ?? {});
  const { defaultCountry } = await getSetting(db, 'ministry.profile');
  const { where, orderBy, contactVisible } = peopleDirectoryQuery(ctx, filters, defaultCountry);

  const leader = alias(people, 'leader');
  const primary = alias(people, 'primary_leader');
  const rows = await db
    .select({
      id: people.id,
      personCode: people.personCode,
      firstName: people.firstName,
      lastName: people.lastName,
      preferredName: people.preferredName,
      status: people.status,
      registrationStatus: people.registrationStatus,
      joinedOn: people.joinedOn,
      phoneE164: sql<string | null>`CASE WHEN ${contactVisible} THEN ${people.phoneE164} END`,
      email: sql<string | null>`CASE WHEN ${contactVisible} THEN ${people.email} END`,
      leaderFirst: leader.firstName,
      leaderLast: leader.lastName,
      primaryId: primary.id,
      primaryFirst: primary.firstName,
      primaryLast: primary.lastName,
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
    .where(and(where, personScopeFilter(ctx, 'people.export', people.id)))
    .orderBy(...orderBy)
    .limit(MAX_EXPORT_ROWS);

  const csv = toCsv(
    ['Person code', 'First name', 'Last name', 'Preferred name', 'Status', 'Registration', 'Leader', 'Primary leader', 'Level', 'Ministry', 'Mobile', 'Email', 'Joined'],
    rows.map((r) => [
      r.personCode,
      r.firstName,
      r.lastName,
      r.preferredName ?? '',
      STATUS_LABEL[r.status] ?? r.status,
      REGISTRATION_LABEL[r.registrationStatus] ?? r.registrationStatus,
      r.leaderFirst ? `${r.leaderFirst} ${r.leaderLast}` : '',
      r.primaryId && r.primaryId !== r.id && r.primaryFirst ? `${r.primaryFirst} ${r.primaryLast}` : '',
      r.levelName ?? '',
      r.ministryName ?? '',
      r.phoneE164 ? formatPhone(r.phoneE164, defaultCountry) : '',
      r.email ?? '',
      r.joinedOn ?? '',
    ]),
  );

  const { page: _page, pageSize: _pageSize, ...appliedFilters } = filters;
  await recordAudit(db, ctx, {
    category: 'access',
    action: 'people.exported',
    entityType: 'report',
    entityId: 'people_directory',
    newValues: { filters: appliedFilters, rows: rows.length },
  });
  return { filename: csvFilename('people', ctx.now.toISOString().slice(0, 10)), csv, truncated: rows.length === MAX_EXPORT_ROWS };
}
