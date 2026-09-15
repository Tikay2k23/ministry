import { eq } from 'drizzle-orm';
import type { RequestContext } from '@/server/context/request-context';
import type { Database } from '@/server/db/client';
import { users } from '@/server/db/schema';
import { seedReferenceData } from '@/server/db/seed/reference-data';
import { ensureSuperAdmin } from '@/server/db/seed/super-admin';
import { setEmailProvider } from '@/server/email/email';
import { placePerson } from '@/server/modules/hierarchy/hierarchy.service';
import { inviteUser } from '@/server/modules/iam/users.service';
import { createPerson } from '@/server/modules/people/people.service';
import { loadGrants } from '@/server/policy/grants';
import { userContext } from './fixtures';

export async function contextFor(db: Database, userId: string): Promise<RequestContext> {
  const [user] = await db.select({ personId: users.personId }).from(users).where(eq(users.id, userId));
  return userContext(
    { id: userId, personId: user?.personId ?? null },
    await loadGrants(db, userId, { now: new Date(), twoFactorVerified: true }),
  );
}

/**
 * A small ministry used by integration tests:
 *   Eduardo (pastor, root)
 *   ├─ Michael (primary) ── Mark (leader, portal user) ── John
 *   └─ Samuel  (primary) ── Anna (leader) ── Grace
 */
export async function buildWorld(db: Database) {
  await seedReferenceData(db);
  setEmailProvider({ send: async () => {} });
  const { userId: adminUserId } = await ensureSuperAdmin(db, { email: 'owner@gentouch.test', firstName: 'Ministry', lastName: 'Owner' });
  const admin = await contextFor(db, adminUserId);

  const add = async (firstName: string, lastName: string, leaderId?: string) =>
    (await createPerson(db, admin, { firstName, lastName, leaderId })).personId;

  const pastor = await add('Eduardo', 'Villanueva');
  await placePerson(db, admin, { personId: pastor, leaderId: null });
  const michael = await add('Michael', 'Reyes', pastor);
  const samuel = await add('Samuel', 'Torres', pastor);
  const mark = await add('Mark', 'Santos', michael);
  const anna = await add('Anna', 'Lim', samuel);
  const john = await add('John', 'Cruz', mark);
  const grace = await add('Grace', 'Mendoza', anna);

  const { userId: markUserId } = await inviteUser(db, admin, { personId: mark, email: 'mark@gentouch.test', roleKey: 'leader' });
  const { userId: annaUserId } = await inviteUser(db, admin, { personId: anna, email: 'anna@gentouch.test', roleKey: 'leader' });

  return {
    admin,
    markCtx: await contextFor(db, markUserId),
    annaCtx: await contextFor(db, annaUserId),
    ids: { pastor, michael, samuel, mark, anna, john, grace },
  };
}
