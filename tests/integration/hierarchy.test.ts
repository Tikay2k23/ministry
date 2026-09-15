import { eq, sql } from 'drizzle-orm';
import fc from 'fast-check';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { DatabaseHandle } from '@/server/db/client';
import { hierarchyNodes, leadershipHistory } from '@/server/db/schema';
import { deleteLeafNode, getNode, insertNode, lockHierarchy, moveSubtree } from '@/server/modules/hierarchy/hierarchy.core';
import { movePerson, placePerson, removeFromHierarchy } from '@/server/modules/hierarchy/hierarchy.service';
import { isConsistent, verifyHierarchy } from '@/server/modules/hierarchy/hierarchy.verify';
import { createTestDatabase } from '../helpers/db';
import { branchGrant, createPerson, createUser, globalGrant, userContext } from '../helpers/fixtures';

const PRIMARY_DEPTH = 1; // default setting: depth 0 = senior leadership, depth 1 = Primary Leaders

let handle: DatabaseHandle;
let db: DatabaseHandle['db'];

beforeAll(async () => {
  handle = await createTestDatabase();
  db = handle.db;
});

afterAll(async () => {
  await handle.close();
});

async function resetTree() {
  await db.execute(sql`TRUNCATE leadership_history, hierarchy_closure, hierarchy_nodes CASCADE`);
}

async function place(personId: string, parentPersonId: string | null) {
  await db.transaction(async (tx) => {
    await lockHierarchy(tx);
    await insertNode(tx, { personId, parentPersonId, primaryLeaderDepth: PRIMARY_DEPTH });
  });
}

async function expectConsistent() {
  const verification = await verifyHierarchy(db, PRIMARY_DEPTH);
  expect(verification).toEqual({ missingClosureRows: 0, extraClosureRows: 0, wrongDepth: 0, wrongPrimaryLeader: 0 });
}

describe('hierarchy core (closure table)', () => {
  beforeEach(resetTree);

  it('builds closure rows, depths and primary leaders for a new branch', async () => {
    const pastor = await createPerson(db);
    const primary = await createPerson(db);
    const leader = await createPerson(db);
    const member = await createPerson(db);
    await place(pastor.id, null);
    await place(primary.id, pastor.id);
    await place(leader.id, primary.id);
    await place(member.id, leader.id);

    expect((await getNode(db, pastor.id))?.primaryLeaderPersonId).toBeNull();
    expect((await getNode(db, primary.id))?.primaryLeaderPersonId).toBe(primary.id);
    expect((await getNode(db, member.id))).toMatchObject({ depth: 3, primaryLeaderPersonId: primary.id });
    await expectConsistent();
  });

  it('moves a whole sub-tree and recomputes depth and primary leader', async () => {
    const pastor = await createPerson(db);
    const primaryA = await createPerson(db);
    const primaryB = await createPerson(db);
    const leader = await createPerson(db);
    const member = await createPerson(db);
    for (const [p, parent] of [
      [pastor, null],
      [primaryA, pastor],
      [primaryB, pastor],
      [leader, primaryA],
      [member, leader],
    ] as const) {
      await place(p.id, parent?.id ?? null);
    }

    await db.transaction((tx) =>
      moveSubtree(tx, { personId: leader.id, newParentPersonId: primaryB.id, primaryLeaderDepth: PRIMARY_DEPTH }),
    );
    expect(await getNode(db, member.id)).toMatchObject({ depth: 3, primaryLeaderPersonId: primaryB.id });

    // Promote the leader to a root: depths shift up, primary leader becomes the leader's child line.
    await db.transaction((tx) =>
      moveSubtree(tx, { personId: leader.id, newParentPersonId: null, primaryLeaderDepth: PRIMARY_DEPTH }),
    );
    expect(await getNode(db, leader.id)).toMatchObject({ depth: 0, parentPersonId: null, primaryLeaderPersonId: null });
    expect(await getNode(db, member.id)).toMatchObject({ depth: 1, primaryLeaderPersonId: member.id });
    await expectConsistent();
  });

  it('rejects a move that would create a cycle', async () => {
    const a = await createPerson(db);
    const b = await createPerson(db);
    const c = await createPerson(db);
    await place(a.id, null);
    await place(b.id, a.id);
    await place(c.id, b.id);

    await expect(
      db.transaction((tx) => moveSubtree(tx, { personId: a.id, newParentPersonId: c.id, primaryLeaderDepth: PRIMARY_DEPTH })),
    ).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
    await expectConsistent();
  });

  it('refuses to remove a leader who still has a group', async () => {
    const a = await createPerson(db);
    const b = await createPerson(db);
    await place(a.id, null);
    await place(b.id, a.id);

    await expect(db.transaction((tx) => deleteLeafNode(tx, a.id))).rejects.toMatchObject({ code: 'INVALID_STATE' });
    await db.transaction((tx) => deleteLeafNode(tx, b.id));
    expect(await getNode(db, b.id)).toBeNull();
    await expectConsistent();
  });

  it('keeps the closure consistent under random place / move / remove sequences', async () => {
    const pool = await Promise.all(Array.from({ length: 24 }, () => createPerson(db)));
    const ids = pool.map((p) => p.id);

    const op = fc.record({
      kind: fc.constantFrom('place', 'place', 'move', 'move', 'remove'),
      a: fc.nat(),
      b: fc.nat(),
      toRoot: fc.boolean(),
    });

    await fc.assert(
      fc.asyncProperty(fc.array(op, { minLength: 5, maxLength: 40 }), async (ops) => {
        await resetTree();
        const parent = new Map<string, string | null>(); // model of the tree

        const subtreeOf = (root: string) => {
          const out = new Set([root]);
          let grew = true;
          while (grew) {
            grew = false;
            for (const [child, p] of parent) {
              if (p && out.has(p) && !out.has(child)) {
                out.add(child);
                grew = true;
              }
            }
          }
          return out;
        };

        for (const o of ops) {
          const placed = [...parent.keys()];
          const unplaced = ids.filter((id) => !parent.has(id));
          if (o.kind === 'place' && unplaced.length) {
            const person = unplaced[o.a % unplaced.length]!;
            const leader = o.toRoot || placed.length === 0 ? null : placed[o.b % placed.length]!;
            await place(person, leader);
            parent.set(person, leader);
          } else if (o.kind === 'move' && placed.length) {
            const person = placed[o.a % placed.length]!;
            const target = o.toRoot ? null : placed[o.b % placed.length]!;
            const wouldCycle = target !== null && subtreeOf(person).has(target);
            const move = db.transaction((tx) =>
              moveSubtree(tx, { personId: person, newParentPersonId: target, primaryLeaderDepth: PRIMARY_DEPTH }),
            );
            if (wouldCycle) await expect(move).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
            else {
              await move;
              parent.set(person, target);
            }
          } else if (o.kind === 'remove' && placed.length) {
            const person = placed[o.a % placed.length]!;
            const hasChildren = [...parent.values()].includes(person);
            const remove = db.transaction((tx) => deleteLeafNode(tx, person));
            if (hasChildren) await expect(remove).rejects.toMatchObject({ code: 'INVALID_STATE' });
            else {
              await remove;
              parent.delete(person);
            }
          }
        }

        // Database adjacency matches the model, and the closure/depth/primary are consistent.
        const rows = await db.select({ personId: hierarchyNodes.personId, parent: hierarchyNodes.parentPersonId }).from(hierarchyNodes);
        expect(new Map(rows.map((r) => [r.personId, r.parent]))).toEqual(parent);
        expect(isConsistent(await verifyHierarchy(db, PRIMARY_DEPTH))).toBe(true);
      }),
      { numRuns: 25 },
    );
  }, 180_000);
});

describe('hierarchy service (authorisation, history, audit)', () => {
  beforeEach(resetTree);

  async function world() {
    const pastor = await createPerson(db);
    const michael = await createPerson(db, { firstName: 'Michael' }); // primary leader A
    const samuel = await createPerson(db, { firstName: 'Samuel' }); // primary leader B
    const mark = await createPerson(db, { firstName: 'Mark' }); // leader under Michael
    const anna = await createPerson(db, { firstName: 'Anna' }); // leader under Michael
    const john = await createPerson(db, { firstName: 'John' }); // member under Mark
    await place(pastor.id, null);
    await place(michael.id, pastor.id);
    await place(samuel.id, pastor.id);
    await place(mark.id, michael.id);
    await place(anna.id, michael.id);
    await place(john.id, mark.id);
    return { pastor, michael, samuel, mark, anna, john };
  }

  it('lets an administrator move a person and records history + audit', async () => {
    const w = await world();
    const admin = await createUser(db);
    const ctx = userContext(admin, [globalGrant('hierarchy.manage')]);

    const result = await movePerson(db, ctx, { personId: w.john.id, newLeaderId: w.anna.id, reason: 'Moved city' });
    expect(result.movedCount).toBe(1);
    expect((await getNode(db, w.john.id))?.parentPersonId).toBe(w.anna.id);

    const history = await db.select().from(leadershipHistory).where(eq(leadershipHistory.personId, w.john.id));
    expect(history.at(-1)).toMatchObject({ changeType: 'moved', previousLeaderPersonId: w.mark.id, newLeaderPersonId: w.anna.id });
  });

  it('lets a Primary Leader move people within their own branch', async () => {
    const w = await world();
    const user = await createUser(db, { personId: w.michael.id });
    const ctx = userContext(user, [branchGrant('hierarchy.manage', w.michael.id)]);

    await movePerson(db, ctx, { personId: w.john.id, newLeaderId: w.anna.id });
    expect((await getNode(db, w.john.id))?.parentPersonId).toBe(w.anna.id);
  });

  it('hides targets outside a Primary Leader’s branch (docs/06 T11)', async () => {
    const w = await world();
    const user = await createUser(db, { personId: w.michael.id });
    const ctx = userContext(user, [branchGrant('hierarchy.manage', w.michael.id)]);

    await expect(movePerson(db, ctx, { personId: w.john.id, newLeaderId: w.samuel.id })).rejects.toMatchObject({
      code: 'NOT_FOUND',
    });
    expect((await getNode(db, w.john.id))?.parentPersonId).toBe(w.mark.id);
  });

  it('forbids people without hierarchy.manage (docs/06 T10)', async () => {
    const w = await world();
    const user = await createUser(db, { personId: w.mark.id });
    const ctx = userContext(user, [branchGrant('hierarchy.view', w.mark.id, 1)]);

    await expect(movePerson(db, ctx, { personId: w.john.id, newLeaderId: w.anna.id })).rejects.toMatchObject({
      code: 'FORBIDDEN',
    });
  });

  it('detects stale edits with expectedLeaderId', async () => {
    const w = await world();
    const admin = await createUser(db);
    const ctx = userContext(admin, [globalGrant('hierarchy.manage')]);

    await expect(
      movePerson(db, ctx, { personId: w.john.id, newLeaderId: w.anna.id, expectedLeaderId: w.anna.id }),
    ).rejects.toMatchObject({ code: 'CONFLICT' });
  });

  it('moves a leader while leaving their group with another leader', async () => {
    const w = await world();
    const admin = await createUser(db);
    const ctx = userContext(admin, [globalGrant('hierarchy.manage')]);

    await movePerson(db, ctx, { personId: w.mark.id, newLeaderId: w.samuel.id, mode: 'leave_group', groupNewLeaderId: w.anna.id });
    expect((await getNode(db, w.mark.id))?.parentPersonId).toBe(w.samuel.id);
    expect((await getNode(db, w.john.id))?.parentPersonId).toBe(w.anna.id);
    await expectConsistent();
  });

  it('places new people and removes leaves, but not leaders with a group', async () => {
    const w = await world();
    const admin = await createUser(db);
    const ctx = userContext(admin, [globalGrant('hierarchy.manage')]);
    const newcomer = await createPerson(db);

    await placePerson(db, ctx, { personId: newcomer.id, leaderId: w.mark.id });
    expect((await getNode(db, newcomer.id))?.depth).toBe(3);

    await expect(removeFromHierarchy(db, ctx, { personId: w.mark.id })).rejects.toMatchObject({ code: 'INVALID_STATE' });
    await removeFromHierarchy(db, ctx, { personId: newcomer.id });
    expect(await getNode(db, newcomer.id)).toBeNull();
    await expectConsistent();
  });
});
