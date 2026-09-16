import { and, eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { RequestContext } from '@/server/context/request-context';
import type { DatabaseHandle } from '@/server/db/client';
import { auditLogs, people, personDuplicateCandidates, users } from '@/server/db/schema';
import { seedReferenceData } from '@/server/db/seed/reference-data';
import { ensureSuperAdmin } from '@/server/db/seed/super-admin';
import { setEmailProvider } from '@/server/email/email';
import { getNode } from '@/server/modules/hierarchy/hierarchy.core';
import { isConsistent, verifyHierarchy } from '@/server/modules/hierarchy/hierarchy.verify';
import { inviteUser } from '@/server/modules/iam/users.service';
import { getPersonDetail, searchPeople } from '@/server/modules/people/people.queries';
import { archivePerson, createPerson, updatePerson } from '@/server/modules/people/people.service';
import { loadGrants } from '@/server/policy/grants';
import { createTestDatabase } from '../helpers/db';
import { branchGrant, globalGrant, userContext } from '../helpers/fixtures';

let handle: DatabaseHandle;
let db: DatabaseHandle['db'];
let admin: RequestContext;
let leaderCtx: RequestContext;
const w = {} as Record<'pastor' | 'michael' | 'samuel' | 'mark' | 'anna' | 'john', string>;

async function contextFor(userId: string) {
  return userContext({ id: userId }, await loadGrants(db, userId, { now: new Date(), twoFactorVerified: true }));
}

async function add(ctx: RequestContext, firstName: string, lastName: string, extra: Record<string, unknown> = {}) {
  const { personId } = await createPerson(db, ctx, { firstName, lastName, ...extra });
  return personId;
}

beforeAll(async () => {
  handle = await createTestDatabase();
  db = handle.db;
  await seedReferenceData(db);
  setEmailProvider({ send: async () => {} });

  const { userId } = await ensureSuperAdmin(db, { email: 'owner@gentouch.test', firstName: 'Ministry', lastName: 'Owner' });
  admin = await contextFor(userId);

  w.pastor = await add(admin, 'Eduardo', 'Villanueva');
  // Roots are placed by admins without a leader; use hierarchy placement through createPerson + leader.
  const { placePerson } = await import('@/server/modules/hierarchy/hierarchy.service');
  await placePerson(db, admin, { personId: w.pastor, leaderId: null });
  w.michael = await add(admin, 'Michael', 'Reyes', { leaderId: w.pastor });
  w.samuel = await add(admin, 'Samuel', 'Torres', { leaderId: w.pastor });
  w.mark = await add(admin, 'Mark', 'Santos', { leaderId: w.michael, phone: '0917 555 0100' });
  w.anna = await add(admin, 'Anna', 'Lim', { leaderId: w.samuel });
  w.john = await add(admin, 'John', 'Cruz', { leaderId: w.mark, phone: '+63 917 555 0101' });

  const { userId: markUserId } = await inviteUser(db, admin, { personId: w.mark, email: 'mark@gentouch.test', roleKey: 'leader' });
  leaderCtx = await contextFor(markUserId);
});

afterAll(async () => {
  setEmailProvider(undefined);
  await handle.close();
});

describe('creating people', () => {
  it('normalises the phone number and places the person under their leader', async () => {
    const id = await add(admin, 'Grace', 'Mendoza', { leaderId: w.anna, phone: '0918 222 3344', designations: ['member'] });
    const [row] = await db.select().from(people).where(eq(people.id, id));
    expect(row).toMatchObject({ phoneE164: '+639182223344', source: 'portal' });
    expect(row!.personCode).toMatch(/^P-[0-9A-HJKMNP-TV-Z]{6}$/);
    expect((await getNode(db, id))?.parentPersonId).toBe(w.anna);
    expect(isConsistent(await verifyHierarchy(db, 1))).toBe(true);
  });

  it('lets a Leader add people only into their own group', async () => {
    const id = await add(leaderCtx, 'Peter', 'Garcia', { leaderId: w.mark });
    expect((await getNode(db, id))?.parentPersonId).toBe(w.mark);

    await expect(createPerson(db, leaderCtx, { firstName: 'Out', lastName: 'Ofscope', leaderId: w.anna })).rejects.toMatchObject({
      code: 'NOT_FOUND',
    });
    await expect(createPerson(db, leaderCtx, { firstName: 'No', lastName: 'Leader' })).rejects.toMatchObject({
      code: 'VALIDATION_ERROR',
    });
  });

  it('rejects an invalid phone number with a field message', async () => {
    await expect(createPerson(db, admin, { firstName: 'Bad', lastName: 'Phone', phone: '12345' })).rejects.toMatchObject({
      code: 'VALIDATION_ERROR',
      details: { fieldErrors: { phone: expect.any(Array) } },
    });
  });

  it('flags likely duplicates without revealing people outside the actor’s scope', async () => {
    await add(admin, 'Joy', 'Ramos', { leaderId: w.anna, phone: '0917 777 8888' });

    // Mark cannot see Anna's group: he learns only that a match exists.
    await expect(
      createPerson(db, leaderCtx, { firstName: 'Joy', lastName: 'Ramos', leaderId: w.mark, phone: '0917 777 8888' }),
    ).rejects.toMatchObject({ code: 'CONFLICT', details: { meta: { reason: 'DUPLICATE_SUSPECTED', candidates: [], hiddenCount: 1 } } });

    // The administrator sees who it is.
    await expect(
      createPerson(db, admin, { firstName: 'Joy', lastName: 'Ramos', leaderId: w.mark, phone: '0917 777 8888' }),
    ).rejects.toMatchObject({ details: { meta: { candidates: [expect.objectContaining({ name: 'Joy Ramos' })] } } });

    // After confirming it's a different person, it is created and queued for review.
    const id = await add(admin, 'Joy', 'Ramos', { leaderId: w.mark, phone: '0917 777 8888', confirmNotDuplicate: true });
    const queued = await db.select().from(personDuplicateCandidates).where(eq(personDuplicateCandidates.status, 'open'));
    expect(queued.some((c) => c.personAId === id || c.personBId === id)).toBe(true);
  });
});

describe('updating and archiving', () => {
  it('uses optimistic concurrency and redacts contact changes in the audit log', async () => {
    const [before] = await db.select().from(people).where(eq(people.id, w.john));
    await expect(
      updatePerson(db, admin, { personId: w.john, expectedUpdatedAt: new Date(0).toISOString(), firstName: 'Johnny' }),
    ).rejects.toMatchObject({ code: 'CONFLICT' });

    await updatePerson(db, admin, { personId: w.john, expectedUpdatedAt: before!.updatedAt.toISOString(), phone: '0917 555 0199' });
    const [audit] = await db
      .select()
      .from(auditLogs)
      .where(and(eq(auditLogs.action, 'person.updated'), eq(auditLogs.entityId, w.john)));
    expect(audit!.newValues).toMatchObject({ phoneE164: '[changed]' });
  });

  it('forbids contact changes without people.contact.edit', async () => {
    const [before] = await db.select().from(people).where(eq(people.id, w.john));
    const editorWithoutContact = userContext({ id: (await db.select().from(users).limit(1))[0]!.id }, [
      globalGrant('people.edit'),
      globalGrant('people.view'),
    ]);
    await expect(
      updatePerson(db, editorWithoutContact, { personId: w.john, expectedUpdatedAt: before!.updatedAt.toISOString(), email: 'john@example.org' }),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });
  });

  it('will not mark a leader with a group inactive or archive them', async () => {
    const [mark] = await db.select().from(people).where(eq(people.id, w.mark));
    await expect(
      updatePerson(db, admin, { personId: w.mark, expectedUpdatedAt: mark!.updatedAt.toISOString(), status: 'inactive' }),
    ).rejects.toMatchObject({ code: 'INVALID_STATE' });
    await expect(archivePerson(db, admin, { personId: w.mark, reason: 'left' })).rejects.toMatchObject({ code: 'INVALID_STATE' });
  });

  it('archives a member: removes them from the tree and ends their portal access', async () => {
    const id = await add(admin, 'Temp', 'Member', { leaderId: w.anna });
    const { userId } = await inviteUser(db, admin, { personId: id, email: 'temp.member@gentouch.test', roleKey: 'viewer' });

    await archivePerson(db, admin, { personId: id, reason: 'moved' });
    expect(await getNode(db, id)).toBeNull();
    const [user] = await db.select().from(users).where(eq(users.id, userId));
    expect(user!.status).toBe('deactivated');
    expect(isConsistent(await verifyHierarchy(db, 1))).toBe(true);
  });
});

describe('directory search and profiles', () => {
  it('limits a Leader’s search to their own group (docs/06 T3)', async () => {
    const mine = await searchPeople(db, leaderCtx, {});
    const ids = mine.items.map((p) => p.id);
    expect(ids).toContain(w.john);
    expect(ids).not.toContain(w.anna);

    const sneaky = await searchPeople(db, leaderCtx, { leaderId: w.samuel });
    expect(sneaky.total).toBe(0);
  });

  it('treats SQL and LIKE wildcards in a search as plain text (docs/07 security tests)', async () => {
    const everyone = (await searchPeople(db, admin, {})).total;
    for (const q of ["' OR '1'='1", "'; DROP TABLE people; --", '%', '_', '\\', '%%%%']) {
      expect((await searchPeople(db, admin, { q })).total, q).toBe(0);
    }
    // A name with a quote in the search still finds the person, and the table is untouched.
    expect((await searchPeople(db, admin, { q: "Mark' --" })).items.some((p) => p.name.startsWith('Mark'))).toBe(true);
    expect((await searchPeople(db, admin, {})).total).toBe(everyone);
  });

  it('finds names without accents and phones only within contact scope', async () => {
    await add(admin, 'José', 'Peña', { leaderId: w.mark });
    const byName = await searchPeople(db, admin, { q: 'jose pena' });
    expect(byName.items[0]?.name).toBe('José Peña');

    const byPhone = await searchPeople(db, admin, { q: '0917 777 8888' });
    expect(byPhone.total).toBeGreaterThanOrEqual(1);
    const viewerOnly = userContext({ id: 'x' }, [globalGrant('people.view')]);
    expect((await searchPeople(db, viewerOnly, { q: '0917 777 8888' })).total).toBe(0);
  });

  it('paginates with an accurate total', async () => {
    const page1 = await searchPeople(db, admin, { pageSize: 25, page: 1 });
    const all = await db.select().from(people);
    const active = all.filter((p) => !p.archivedAt).length;
    expect(page1.total).toBe(active);
    expect(page1.items.length).toBe(Math.min(25, active));
  });

  it('hides out-of-scope profiles and redacts contact details without contact access', async () => {
    await expect(getPersonDetail(db, leaderCtx, w.anna)).rejects.toMatchObject({ code: 'NOT_FOUND' });

    const detail = await getPersonDetail(db, leaderCtx, w.john);
    expect(detail.leadership?.chain.map((c) => c.name)).toEqual(['Eduardo Villanueva', 'Michael Reyes', 'Mark Santos']);
    expect(detail.contact?.phoneE164).toBe('+639175550199');

    const noContact = userContext({ id: 'x' }, [branchGrant('people.view', w.mark, 1)]);
    expect((await getPersonDetail(db, noContact, w.john)).contact).toBeNull();
  });
});
