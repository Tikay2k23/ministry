import { eq, inArray } from 'drizzle-orm';
import type { Executor } from '../../db/client';
import type { ServingRoleCategory } from '../../db/enums';
import { gatheringTypeRoles, gatheringTypes, servingRoles } from '../../db/schema';

/**
 * Starting devotional data (FR-DEV-01/02, docs/05 W8 step 1): the serving-role vocabulary and a
 * "Morning Devotional" with its roster template. Created only when missing, so the ministry's own
 * changes — renamed or switched-off roles, an edited template — are never overwritten.
 */

export const DEFAULT_SERVING_ROLES: { key: string; name: string; category: ServingRoleCategory }[] = [
  { key: 'worship_leader', name: 'Worship Leader', category: 'music' },
  { key: 'lead_vocal', name: 'Lead Vocal', category: 'music' },
  { key: 'backup_vocal', name: 'Backup Vocal', category: 'music' },
  { key: 'keyboard', name: 'Keyboard', category: 'music' },
  { key: 'guitar', name: 'Guitar', category: 'music' },
  { key: 'bass', name: 'Bass', category: 'music' },
  { key: 'drums', name: 'Drums', category: 'music' },
  { key: 'prayer_leader', name: 'Prayer Leader', category: 'prayer' },
  { key: 'scripture_reader', name: 'Scripture Reader', category: 'word' },
  { key: 'devotional_leader', name: 'Devotional Leader', category: 'word' },
  { key: 'host', name: 'Host', category: 'hosting' },
  { key: 'sound', name: 'Tech / Sound', category: 'production' },
];

/** [role key, required, most] — "Backup Vocal ×2, Bass ×0–1" (docs/05 W8 step 1). */
const MORNING_DEVOTIONAL_TEMPLATE: [string, number, number][] = [
  ['worship_leader', 1, 1],
  ['lead_vocal', 1, 1],
  ['backup_vocal', 2, 2],
  ['keyboard', 1, 1],
  ['guitar', 1, 1],
  ['bass', 0, 1],
  ['drums', 0, 1],
  ['prayer_leader', 1, 1],
  ['scripture_reader', 1, 1],
  ['devotional_leader', 1, 1],
  ['host', 1, 1],
  ['sound', 1, 1],
];

export async function ensureDevotionalDefaults(tx: Executor): Promise<void> {
  await tx
    .insert(servingRoles)
    .values(DEFAULT_SERVING_ROLES.map((role, sortOrder) => ({ ...role, sortOrder })))
    .onConflictDoNothing({ target: servingRoles.key });

  const [existing] = await tx.select({ id: gatheringTypes.id }).from(gatheringTypes).where(eq(gatheringTypes.key, 'morning_devotional'));
  if (existing) return;
  const [type] = await tx
    .insert(gatheringTypes)
    .values({ key: 'morning_devotional', name: 'Morning Devotional', defaultStartTime: '06:00:00', defaultDurationMinutes: 60 })
    .returning({ id: gatheringTypes.id });
  const roles = await tx
    .select({ id: servingRoles.id, key: servingRoles.key })
    .from(servingRoles)
    .where(inArray(servingRoles.key, MORNING_DEVOTIONAL_TEMPLATE.map(([key]) => key)));
  const values = MORNING_DEVOTIONAL_TEMPLATE.flatMap(([key, minCount, maxCount], sortOrder) => {
    const role = roles.find((r) => r.key === key);
    return role ? [{ gatheringTypeId: type!.id, servingRoleId: role.id, minCount, maxCount, sortOrder }] : [];
  });
  if (values.length > 0) await tx.insert(gatheringTypeRoles).values(values);
}
