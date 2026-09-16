import { eq } from 'drizzle-orm';
import { openDatabase } from '@/server/db/client';
import { runMigrations } from '@/server/db/migrate';
import { users } from '@/server/db/schema';
import { seedReferenceData } from '@/server/db/seed/reference-data';
import { ensureSuperAdmin } from '@/server/db/seed/super-admin';
import { placePerson } from '@/server/modules/hierarchy/hierarchy.service';
import { createMinistry } from '@/server/modules/ministries/ministries.service';
import { createPerson } from '@/server/modules/people/people.service';
import { loadGrants } from '@/server/policy/grants';
import { userContext } from '../helpers/fixtures';
import { E2E_ADMIN_EMAIL, E2E_LEADER, E2E_MEMBER, E2E_PASTOR } from './support/e2e-env';

/**
 * Test data for the end-to-end tests, created through the same services the portal uses:
 * a Super Admin, a pastor → leader → member line where the member journals by phone, and a
 * Worship ministry for the devotional test's worship team.
 */
export async function seedE2eData(databaseUrl: string): Promise<void> {
  const handle = openDatabase(databaseUrl);
  try {
    await runMigrations(handle);
    const db = handle.db;
    await seedReferenceData(db);

    const { userId } = await ensureSuperAdmin(db, { email: E2E_ADMIN_EMAIL, firstName: 'Ministry', lastName: 'Admin' });
    const [user] = await db.select({ personId: users.personId }).from(users).where(eq(users.id, userId));
    const now = new Date();
    const admin = userContext({ id: userId, personId: user?.personId ?? null }, await loadGrants(db, userId, { now, twoFactorVerified: true }), now);

    const { personId: pastor } = await createPerson(db, admin, { ...E2E_PASTOR });
    await placePerson(db, admin, { personId: pastor, leaderId: null });
    const { personId: leader } = await createPerson(db, admin, { ...E2E_LEADER, leaderId: pastor });
    await createPerson(db, admin, { ...E2E_MEMBER, leaderId: leader });
    await createMinistry(db, admin, { name: 'Worship', code: 'WOR' });
  } finally {
    await handle.close();
  }
}
