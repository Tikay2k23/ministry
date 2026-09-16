import { sql } from 'drizzle-orm';
import { queryRows, type Executor } from '../../db/client';
import { gatheringAssignments } from '../../db/schema';
import { lastServed, peopleServingElsewhere, unavailablePeople } from './availability';

/**
 * Filling a roster from the gathering's team (docs/05 W8 step 4). For each role in the gathering
 * type's template, team members whose default roles include it are picked:
 * - people without a role in this gathering yet first (someone doubles up only when a required
 *   place would otherwise stay open);
 * - their primary role first;
 * - then whoever served in that role least recently.
 * Unavailable people and people serving in an overlapping gathering are skipped. Required places
 * that stay open are reported as gaps, never silently dropped.
 */

export interface RosterGap {
  servingRoleId: string;
  roleName: string;
  missing: number;
}

interface TemplateRow {
  serving_role_id: string;
  role_name: string;
  min_count: number;
  max_count: number;
}

interface MemberRow {
  person_id: string;
  serving_role_id: string;
  is_primary: boolean;
  first_name: string;
  last_name: string;
}

export async function rosterTemplate(executor: Executor, gatheringTypeId: string): Promise<TemplateRow[]> {
  return queryRows<TemplateRow>(
    executor,
    sql`SELECT gtr.serving_role_id, sr.name AS role_name, gtr.min_count, gtr.max_count
          FROM gathering_type_roles gtr
          JOIN serving_roles sr ON sr.id = gtr.serving_role_id AND sr.is_active
         WHERE gtr.gathering_type_id = ${gatheringTypeId}::uuid
         ORDER BY gtr.sort_order, sr.sort_order, sr.name`,
  );
}

export async function autoFillRoster(
  tx: Executor,
  gathering: { id: string; gatheringTypeId: string; teamId: string | null; startsAt: Date; endsAt: Date },
): Promise<{ assigned: number; gaps: RosterGap[] }> {
  const template = await rosterTemplate(tx, gathering.gatheringTypeId);
  const existing = await queryRows<{ person_id: string; serving_role_id: string }>(
    tx,
    sql`SELECT person_id, serving_role_id FROM gathering_assignments
         WHERE gathering_id = ${gathering.id}::uuid AND status IN ('pending', 'confirmed')`,
  );

  const members = gathering.teamId
    ? await queryRows<MemberRow>(
        tx,
        sql`SELECT tm.person_id, tmsr.serving_role_id, tmsr.is_primary, p.first_name, p.last_name
              FROM team_memberships tm
              JOIN team_member_serving_roles tmsr ON tmsr.team_membership_id = tm.id
              JOIN people p ON p.id = tm.person_id AND p.archived_at IS NULL AND p.status = 'active'
             WHERE tm.team_id = ${gathering.teamId}::uuid AND tm.left_on IS NULL`,
      )
    : [];
  const personIds = [...new Set(members.map((m) => m.person_id))];
  const [unavailable, busy, served] = await Promise.all([
    unavailablePeople(tx, personIds, gathering.startsAt, gathering.endsAt),
    peopleServingElsewhere(tx, personIds, { startsAt: gathering.startsAt, endsAt: gathering.endsAt, exceptGatheringId: gathering.id }),
    lastServed(tx, personIds, gathering.startsAt),
  ]);

  const rolesHeld = new Map<string, number>();
  for (const row of existing) rolesHeld.set(row.person_id, (rolesHeld.get(row.person_id) ?? 0) + 1);
  const holds = (personId: string, roleId: string) => existing.some((e) => e.person_id === personId && e.serving_role_id === roleId);

  const inserts: (typeof gatheringAssignments.$inferInsert)[] = [];
  const gaps: RosterGap[] = [];
  for (const role of template) {
    const have = existing.filter((e) => e.serving_role_id === role.serving_role_id).length;
    const required = Math.max(0, role.min_count - have);
    let open = Math.max(0, role.max_count - have);

    const candidates = members
      .filter((m) => m.serving_role_id === role.serving_role_id && !unavailable.has(m.person_id) && !busy.has(m.person_id) && !holds(m.person_id, role.serving_role_id))
      .sort((a, b) => {
        const heldA = rolesHeld.get(a.person_id) ?? 0;
        const heldB = rolesHeld.get(b.person_id) ?? 0;
        if (heldA !== heldB) return heldA - heldB;
        if (a.is_primary !== b.is_primary) return a.is_primary ? -1 : 1;
        const lastA = served.get(`${a.person_id}:${role.serving_role_id}`)?.getTime() ?? 0;
        const lastB = served.get(`${b.person_id}:${role.serving_role_id}`)?.getTime() ?? 0;
        if (lastA !== lastB) return lastA - lastB;
        return a.last_name.localeCompare(b.last_name) || a.first_name.localeCompare(b.first_name) || a.person_id.localeCompare(b.person_id);
      });

    let placed = 0;
    for (const candidate of candidates) {
      if (open === 0) break;
      // Doubling up only fills required places.
      if ((rolesHeld.get(candidate.person_id) ?? 0) > 0 && placed >= required) continue;
      inserts.push({ gatheringId: gathering.id, servingRoleId: role.serving_role_id, personId: candidate.person_id, source: 'rotation' });
      existing.push({ person_id: candidate.person_id, serving_role_id: role.serving_role_id });
      rolesHeld.set(candidate.person_id, (rolesHeld.get(candidate.person_id) ?? 0) + 1);
      placed += 1;
      open -= 1;
    }
    if (placed < required) gaps.push({ servingRoleId: role.serving_role_id, roleName: role.role_name, missing: required - placed });
  }

  if (inserts.length > 0) await tx.insert(gatheringAssignments).values(inserts);
  return { assigned: inserts.length, gaps };
}
