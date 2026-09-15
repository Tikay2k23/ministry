import { and, eq, isNull } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { DatabaseHandle } from '@/server/db/client';
import { ministryMemberships } from '@/server/db/schema';
import {
  addMinistryMember,
  addTeamMember,
  createDepartment,
  createMinistry,
  createTeam,
  endMinistryMembership,
  getMinistry,
  listMinistries,
} from '@/server/modules/ministries/ministries.service';
import { createTestDatabase } from '../helpers/db';
import { userContext } from '../helpers/fixtures';
import { buildWorld } from '../helpers/world';

let handle: DatabaseHandle;
let world: Awaited<ReturnType<typeof buildWorld>>;

beforeAll(async () => {
  handle = await createTestDatabase();
  world = await buildWorld(handle.db);
});

afterAll(async () => {
  await handle.close();
});

describe('ministry structure', () => {
  it('creates ministries, departments and teams with clear conflicts', async () => {
    const { ministryId } = await createMinistry(handle.db, world.admin, { name: 'Worship', code: 'wor' });
    await expect(createMinistry(handle.db, world.admin, { name: 'Worship Arts', code: 'WOR' })).rejects.toMatchObject({ code: 'CONFLICT' });

    const { departmentId } = await createDepartment(handle.db, world.admin, { ministryId, name: 'Music' });
    await createTeam(handle.db, world.admin, { ministryId, departmentId, name: 'Team A', teamType: 'worship' });

    const { ministryId: otherId } = await createMinistry(handle.db, world.admin, { name: 'Youth', code: 'YTH' });
    await expect(
      createTeam(handle.db, world.admin, { ministryId: otherId, departmentId, name: 'Wrong department' }),
    ).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });

    const detail = await getMinistry(handle.db, world.admin, ministryId);
    expect(detail.departments.map((d) => d.name)).toEqual(['Music']);
    expect(detail.teams).toEqual([expect.objectContaining({ name: 'Team A', teamType: 'worship' })]);
  });

  it('keeps one primary ministry per person and one active membership per ministry', async () => {
    const ministries = await listMinistries(handle.db, world.admin);
    const worship = ministries.find((m) => m.code === 'WOR')!;
    const youth = ministries.find((m) => m.code === 'YTH')!;

    await addMinistryMember(handle.db, world.admin, { personId: world.ids.john, ministryId: worship.id, isPrimary: true });
    await expect(
      addMinistryMember(handle.db, world.admin, { personId: world.ids.john, ministryId: worship.id }),
    ).rejects.toMatchObject({ code: 'CONFLICT' });
    const { membershipId } = await addMinistryMember(handle.db, world.admin, {
      personId: world.ids.john,
      ministryId: youth.id,
      isPrimary: true,
    });

    const active = await handle.db
      .select()
      .from(ministryMemberships)
      .where(and(eq(ministryMemberships.personId, world.ids.john), isNull(ministryMemberships.endedOn)));
    expect(active.filter((m) => m.isPrimary).map((m) => m.ministryId)).toEqual([youth.id]);

    await endMinistryMembership(handle.db, world.admin, { membershipId });
    const [ended] = await handle.db.select().from(ministryMemberships).where(eq(ministryMemberships.id, membershipId));
    expect(ended!.endedOn).not.toBeNull();
  });

  it('scopes a Ministry Head to their own ministry', async () => {
    const ministries = await listMinistries(handle.db, world.admin);
    const worship = ministries.find((m) => m.code === 'WOR')!;
    const youth = ministries.find((m) => m.code === 'YTH')!;
    const head = userContext({ id: world.admin.actor.kind === 'user' ? world.admin.actor.userId : '' }, [
      { permission: 'ministries.view', scope: { type: 'ministry', ministryId: worship.id }, roleKey: 'ministry_head' },
      { permission: 'ministry.structure.manage', scope: { type: 'ministry', ministryId: worship.id }, roleKey: 'ministry_head' },
      { permission: 'ministry.members.manage', scope: { type: 'ministry', ministryId: worship.id }, roleKey: 'ministry_head' },
      { permission: 'people.view', scope: { type: 'ministry', ministryId: worship.id }, roleKey: 'ministry_head' },
    ]);

    expect((await listMinistries(handle.db, head)).map((m) => m.code)).toEqual(['WOR']);
    await createDepartment(handle.db, head, { ministryId: worship.id, name: 'Production' });
    await expect(createDepartment(handle.db, head, { ministryId: youth.id, name: 'Games' })).rejects.toMatchObject({
      code: 'NOT_FOUND',
    });
    // People outside the ministry are invisible to the head, so they cannot be added blindly.
    await expect(
      addMinistryMember(handle.db, head, { personId: world.ids.grace, ministryId: worship.id }),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
    const detail = await getMinistry(handle.db, head, worship.id);
    expect(detail.members.map((m) => m.firstName)).toEqual(['John']);
  });

  it('adds people to teams once', async () => {
    const worship = (await listMinistries(handle.db, world.admin)).find((m) => m.code === 'WOR')!;
    const teamA = (await getMinistry(handle.db, world.admin, worship.id)).teams[0]!;
    await addTeamMember(handle.db, world.admin, { teamId: teamA.id, personId: world.ids.grace });
    await expect(addTeamMember(handle.db, world.admin, { teamId: teamA.id, personId: world.ids.grace })).rejects.toMatchObject({
      code: 'CONFLICT',
    });
  });
});
