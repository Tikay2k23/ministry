import { and, eq, isNull, sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { queryRows, type DatabaseHandle } from '@/server/db/client';
import { userRoleAssignments } from '@/server/db/schema';
import type { RequestContext } from '@/server/context/request-context';
import { getDevotionalCalendar } from '@/server/modules/devotional/calendar.service';
import { listWorshipTeams } from '@/server/modules/devotional/teams.service';
import { inviteUser, revokeRole } from '@/server/modules/iam/users.service';
import { addMinistryMember, createMinistry, getMinistry, listMinistries } from '@/server/modules/ministries/ministries.service';
import { isPastoral, isSensitive, PERMISSIONS, ROLES, type PermissionKey } from '@/server/policy/catalog';
import { canAccessPerson, personScopeFilter } from '@/server/policy/can';
import { loadGrants } from '@/server/policy/grants';
import { createTestDatabase } from '../helpers/db';
import { buildWorld, contextFor } from '../helpers/world';

/**
 * The permission suite (docs/06 §6, docs/07 §7): the role bundles checked against the matrix, and
 * every permission of the leadership roles evaluated against every person of the fixture ministry,
 * one by one and as a list query, so an out-of-scope row can never slip through.
 */

type RoleKey = keyof typeof ROLES;
const roleKeys = Object.keys(ROLES) as RoleKey[];
const bundle = (role: RoleKey) =>
  (ROLES[role].permissions as readonly (PermissionKey | { key: PermissionKey; depthCap: number })[]).map((entry) =>
    typeof entry === 'string' ? { key: entry, depthCap: null as number | null } : entry,
  );
const holdersOf = (permission: PermissionKey) => roleKeys.filter((role) => bundle(role).some((e) => e.key === permission)).sort();

describe('role bundles against the permission matrix (docs/06 §2 and §4)', () => {
  it('has the ten roles of the matrix', () => {
    expect([...roleKeys].sort()).toEqual(
      ['leader', 'ministry_admin', 'ministry_head', 'pastor', 'pastoral_care', 'prayer_coordinator', 'primary_leader', 'super_admin', 'viewer', 'worship_coordinator'],
    );
  });

  it('only gives a role permissions that its scope can carry', () => {
    const mismatches = roleKeys.flatMap((role) =>
      bundle(role)
        .filter(({ key }) => !(PERMISSIONS[key].scopes as readonly string[]).includes(ROLES[role].defaultScopeType))
        .map(({ key }) => `${role} (${ROLES[role].defaultScopeType}) → ${key}`),
    );
    expect(mismatches).toEqual([]);
  });

  it('marks exactly the sensitive (⚠) and pastoral (✝) permissions of §4', () => {
    const keys = Object.keys(PERMISSIONS) as PermissionKey[];
    expect(keys.filter(isSensitive).sort()).toEqual(
      [
        'access.break_glass', 'audit.view', 'care.pastoral.view', 'iam.roles.manage', 'iam.users.manage', 'import.manage',
        'journal.content.confidential.view', 'journal.content.restricted.view', 'journal.content.view',
        'journal.proof.manage', 'journal.proof.view',
        'notes.pastoral.create', 'notes.pastoral.view', 'people.export', 'people.merge',
        'prayer.report.attachment.view', 'prayer.reports.view',
        'prayer.requests.confidential.view', 'reports.export', 'settings.manage',
      ].sort(),
    );
    expect(keys.filter(isPastoral).sort()).toEqual(
      [
        'care.pastoral.view', 'journal.content.confidential.view', 'journal.content.restricted.view', 'journal.content.view',
        'journal.proof.manage', 'journal.proof.view',
        'notes.pastoral.create', 'notes.pastoral.view',
        'prayer.report.attachment.view', 'prayer.requests.confidential.view',
      ].sort(),
    );
  });

  it('shows a proof photo to the same people as the answers, and lets only pastors remove one (rows 15a–15b)', () => {
    expect(holdersOf('journal.proof.view')).toEqual(['leader', 'pastor', 'pastoral_care', 'primary_leader']);
    // A leader sees their own group's photos only, as with restricted answers.
    for (const role of ['leader', 'primary_leader'] as const) {
      expect(bundle(role)).toContainEqual({ key: 'journal.proof.view', depthCap: 1 });
    }
    // Removing one is pastoral: not a leader's, and not the Super Admin's either.
    expect(holdersOf('journal.proof.manage')).toEqual(['pastor', 'pastoral_care']);
  });

  it('reads journal content only as pastors, pastoral care and leaders, with restricted answers for the direct group (rows 13–15)', () => {
    expect(holdersOf('journal.content.view')).toEqual(['leader', 'pastor', 'pastoral_care', 'primary_leader']);
    expect(holdersOf('journal.content.restricted.view')).toEqual(['leader', 'pastor', 'pastoral_care', 'primary_leader']);
    for (const role of ['leader', 'primary_leader'] as const) {
      expect(bundle(role)).toContainEqual({ key: 'journal.content.restricted.view', depthCap: 1 });
    }
  });

  it('keeps confidential answers, pastoral follow-ups and pastoral notes to pastors and pastoral care (rows 15, 22, 24, 28)', () => {
    for (const permission of ['journal.content.confidential.view', 'care.pastoral.view', 'notes.pastoral.view', 'notes.pastoral.create', 'prayer.requests.confidential.view'] as const) {
      expect(holdersOf(permission), permission).toEqual(['pastor', 'pastoral_care']);
    }
  });

  it('leaves no pastoral permission with administrators, coordinators or viewers (note c)', () => {
    for (const role of ['super_admin', 'ministry_admin', 'ministry_head', 'prayer_coordinator', 'worship_coordinator', 'viewer'] as const) {
      expect(bundle(role).filter(({ key }) => isPastoral(key)), role).toEqual([]);
    }
  });

  it('keeps imports, merges and user administration with the office and administrators (rows 4, 34)', () => {
    expect(holdersOf('import.manage')).toEqual(['ministry_admin', 'super_admin']);
    expect(holdersOf('people.merge')).toEqual(['ministry_admin', 'super_admin']);
    expect(holdersOf('iam.users.manage')).toEqual(['pastor', 'super_admin']);
    expect(holdersOf('iam.roles.manage')).toEqual(['super_admin']);
    expect(holdersOf('settings.manage')).toEqual(['super_admin']);
    expect(holdersOf('access.break_glass')).toEqual(['super_admin']);
  });

  it('keeps the Viewer read-only', () => {
    expect(bundle('viewer').filter(({ key }) => !key.endsWith('.view'))).toEqual([]);
  });

  it('lets every role see the rosters, and every role but the Worship Coordinator the ministry structure (rows 11, 29)', () => {
    expect(holdersOf('devotional.view')).toEqual([...roleKeys].sort());
    expect(holdersOf('ministries.view')).toEqual(roleKeys.filter((role) => role !== 'worship_coordinator').sort());
  });
});

describe('scope of every leadership permission over the fixture ministry', () => {
  let handle: DatabaseHandle;
  let world: Awaited<ReturnType<typeof buildWorld>>;
  let michaelCtx: RequestContext;
  let pastorCtx: RequestContext;

  // Eduardo (pastor) ─┬─ Michael (primary) ── Mark (leader) ── John
  //                   └─ Samuel (primary) ── Anna (leader) ── Grace
  const parentOf = { pastor: null, michael: 'pastor', samuel: 'pastor', mark: 'michael', anna: 'samuel', john: 'mark', grace: 'anna' } as const;
  type Name = keyof typeof parentOf;
  const names = Object.keys(parentOf) as Name[];

  /** How far below `anchor` a person sits (0 = the anchor), or null outside the anchor's branch. */
  function depthBelow(anchor: Name, person: Name): number | null {
    let depth = 0;
    for (let current: Name | null = person; current !== null; current = parentOf[current], depth += 1) {
      if (current === anchor) return depth;
    }
    return null;
  }

  beforeAll(async () => {
    handle = await createTestDatabase();
    world = await buildWorld(handle.db);
    const { userId: michaelUserId } = await inviteUser(handle.db, world.admin, { personId: world.ids.michael, email: 'michael@gentouch.test', roleKey: 'primary_leader' });
    const { userId: pastorUserId } = await inviteUser(handle.db, world.admin, { personId: world.ids.pastor, email: 'eduardo@gentouch.test', roleKey: 'pastor' });
    michaelCtx = await contextFor(handle.db, michaelUserId);
    pastorCtx = await contextFor(handle.db, pastorUserId);
  });

  afterAll(async () => {
    await handle.close();
  });

  const actors = () => [
    { label: 'Leader Mark', role: 'leader' as const, ctx: world.markCtx, anchor: 'mark' as Name | null, depth: 1 as number | null },
    { label: 'Primary Leader Michael', role: 'primary_leader' as const, ctx: michaelCtx, anchor: 'michael' as Name | null, depth: null as number | null },
    { label: 'Pastor Eduardo', role: 'pastor' as const, ctx: pastorCtx, anchor: null as Name | null, depth: null as number | null },
  ];

  it('sees exactly the expected people for each permission, person by person and in list queries (docs/06 T1–T4, T11)', async () => {
    const mismatches: string[] = [];
    let checks = 0;
    for (const actor of actors()) {
      for (const { key, depthCap } of bundle(actor.role)) {
        const limit = actor.depth === null ? depthCap : depthCap === null ? actor.depth : Math.min(actor.depth, depthCap);
        const expected = names.filter((name) => {
          if (actor.anchor === null) return true; // a global grant
          const depth = depthBelow(actor.anchor, name);
          return depth !== null && (limit === null || depth <= limit);
        });

        for (const name of names) {
          const allowed = await canAccessPerson(handle.db, actor.ctx, key, world.ids[name]);
          if (allowed !== expected.includes(name)) mismatches.push(`${actor.label} · ${key} · ${name}: expected ${expected.includes(name)}`);
          checks += 1;
        }
        const rows = await queryRows<{ id: string }>(
          handle.db,
          sql`SELECT p.id FROM people p WHERE p.id IN (${sql.join(names.map((n) => sql`${world.ids[n]}::uuid`), sql`, `)}) AND ${personScopeFilter(actor.ctx, key, sql`p.id`)}`,
        );
        const listed = names.filter((name) => rows.some((row) => row.id === world.ids[name])).sort();
        if (listed.join() !== [...expected].sort().join()) mismatches.push(`${actor.label} · ${key} · list: ${listed.join()} ≠ ${[...expected].sort().join()}`);
      }
    }
    expect(mismatches).toEqual([]);
    // Every permission of the three bundles against all seven people: hundreds of cells, not a vacuous pass.
    expect(checks).toBeGreaterThan(500);
  });

  it('drops a revoked role on the very next request (T17)', async () => {
    const { userId } = await inviteUser(handle.db, world.admin, { personId: world.ids.samuel, email: 'samuel@gentouch.test', roleKey: 'primary_leader' });
    expect(await canAccessPerson(handle.db, await contextFor(handle.db, userId), 'people.view', world.ids.grace)).toBe(true);

    const [assignment] = await handle.db
      .select({ id: userRoleAssignments.id })
      .from(userRoleAssignments)
      .where(and(eq(userRoleAssignments.userId, userId), isNull(userRoleAssignments.revokedAt)));
    await revokeRole(handle.db, world.admin, { assignmentId: assignment!.id });

    expect(await loadGrants(handle.db, userId, { now: new Date(), twoFactorVerified: true })).toEqual([]);
    expect(await canAccessPerson(handle.db, await contextFor(handle.db, userId), 'people.view', world.ids.grace)).toBe(false);
  });

  it('holds back sensitive permissions until two-step verification (T18)', async () => {
    const userId = world.markCtx.actor.kind === 'user' ? world.markCtx.actor.userId : '';
    const locked = await loadGrants(handle.db, userId, { now: new Date(), twoFactorVerified: false });
    expect(locked.some((g) => g.permission === 'journal.content.view')).toBe(false);
    expect(locked.some((g) => g.permission === 'reports.export')).toBe(false);
    expect(locked.some((g) => g.permission === 'journal.status.view')).toBe(true);
  });

  it('shows leaders every ministry, but only their own people among its members (row 11, note l)', async () => {
    const { ministryId: worship } = await createMinistry(handle.db, world.admin, { name: 'Worship', code: 'WOR' });
    const { ministryId: youth } = await createMinistry(handle.db, world.admin, { name: 'Youth', code: 'YTH' });
    await addMinistryMember(handle.db, world.admin, { personId: world.ids.john, ministryId: worship });
    await addMinistryMember(handle.db, world.admin, { personId: world.ids.grace, ministryId: youth });

    expect((await listMinistries(handle.db, world.markCtx)).map((m) => m.code)).toEqual(['WOR', 'YTH']);
    expect((await getMinistry(handle.db, world.markCtx, worship)).members.map((m) => m.firstName)).toEqual(['John']);
    expect((await getMinistry(handle.db, world.markCtx, youth)).members).toEqual([]);
  });

  it('shows leaders the rosters but not the worship teams and their away dates (rows 29–30)', async () => {
    await expect(getDevotionalCalendar(handle.db, world.markCtx, {})).resolves.toMatchObject({ days: expect.any(Array) });
    await expect(listWorshipTeams(handle.db, world.markCtx)).rejects.toMatchObject({ code: 'NOT_FOUND' });
    await expect(listWorshipTeams(handle.db, pastorCtx)).resolves.toEqual(expect.any(Array));
  });
});
