import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { DatabaseHandle } from '@/server/db/client';
import { leaderChangeRequests, leadershipHistory } from '@/server/db/schema';
import { getNode } from '@/server/modules/hierarchy/hierarchy.core';
import { getVisiblePath, listTreeChildren, listTreeRoots } from '@/server/modules/hierarchy/hierarchy.queries';
import { movePerson } from '@/server/modules/hierarchy/hierarchy.service';
import {
  decideLeaderChangeRequest,
  listLeaderChangeRequests,
  requestLeaderChange,
} from '@/server/modules/hierarchy/leader-change.service';
import { createTestDatabase } from '../helpers/db';
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

describe('leadership tree queries', () => {
  it('starts global viewers at the roots and leaders at themselves', async () => {
    expect((await listTreeRoots(handle.db, world.admin)).map((n) => n.personId)).toEqual([world.ids.pastor]);
    const markRoots = await listTreeRoots(handle.db, world.markCtx);
    expect(markRoots.map((n) => n.personId)).toEqual([world.ids.mark]);
    expect(markRoots[0]!.visibleChildren).toBe(1);
  });

  it('lists only visible children and hides other branches', async () => {
    const children = await listTreeChildren(handle.db, world.markCtx, world.ids.mark);
    expect(children.map((c) => c.personId)).toEqual([world.ids.john]);
    await expect(listTreeChildren(handle.db, world.markCtx, world.ids.anna)).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });

  it('returns the visible path for jumping to a search result', async () => {
    expect(await getVisiblePath(handle.db, world.admin, world.ids.john)).toEqual([
      world.ids.pastor,
      world.ids.michael,
      world.ids.mark,
      world.ids.john,
    ]);
    expect(await getVisiblePath(handle.db, world.markCtx, world.ids.john)).toEqual([world.ids.mark, world.ids.john]);
  });
});

describe('leader change requests', () => {
  it('lets the receiving leader approve a transfer into their group', async () => {
    const { requestId } = await requestLeaderChange(handle.db, world.admin, {
      personId: world.ids.grace,
      toLeaderId: world.ids.mark,
      reason: 'Moved to Mark’s area',
    });

    const incoming = await listLeaderChangeRequests(handle.db, world.markCtx);
    expect(incoming).toEqual([expect.objectContaining({ id: requestId, incoming: true, personName: 'Grace Mendoza' })]);

    // Anna is the sending leader: she can see it but cannot decide it.
    expect((await listLeaderChangeRequests(handle.db, world.annaCtx)).map((r) => r.id)).toContain(requestId);
    await expect(
      decideLeaderChangeRequest(handle.db, world.annaCtx, { requestId, decision: 'approve' }),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });

    await expect(decideLeaderChangeRequest(handle.db, world.markCtx, { requestId, decision: 'approve' })).resolves.toEqual({
      status: 'approved',
    });
    expect((await getNode(handle.db, world.ids.grace))?.parentPersonId).toBe(world.ids.mark);
    const history = await handle.db.select().from(leadershipHistory).where(eq(leadershipHistory.requestId, requestId));
    expect(history).toHaveLength(1);

    await expect(decideLeaderChangeRequest(handle.db, world.markCtx, { requestId, decision: 'reject' })).rejects.toMatchObject({
      code: 'INVALID_STATE',
    });
  });

  it('allows only one pending request per person', async () => {
    await requestLeaderChange(handle.db, world.admin, { personId: world.ids.john, toLeaderId: world.ids.anna });
    await expect(
      requestLeaderChange(handle.db, world.admin, { personId: world.ids.john, toLeaderId: world.ids.samuel }),
    ).rejects.toMatchObject({ code: 'CONFLICT' });
  });

  it('closes a request as superseded when the person was moved meanwhile', async () => {
    const [pending] = await handle.db.select().from(leaderChangeRequests).where(eq(leaderChangeRequests.personId, world.ids.john));
    await movePerson(handle.db, world.admin, { personId: world.ids.john, newLeaderId: world.ids.michael });

    await expect(
      decideLeaderChangeRequest(handle.db, world.annaCtx, { requestId: pending!.id, decision: 'approve' }),
    ).rejects.toMatchObject({ code: 'CONFLICT' });
    const [closed] = await handle.db.select().from(leaderChangeRequests).where(eq(leaderChangeRequests.id, pending!.id));
    expect(closed!.status).toBe('superseded');
  });

  it('rejects requests that would create a cycle', async () => {
    await expect(
      requestLeaderChange(handle.db, world.admin, { personId: world.ids.michael, toLeaderId: world.ids.mark }),
    ).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
  });
});
