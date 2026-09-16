import { and, eq, gt, lte } from 'drizzle-orm';
import { sql } from 'drizzle-orm';
import type { Database } from '../../db/client';
import { gatherings, gatheringTypes } from '../../db/schema';
import { queueNotification } from '../notifications/notifications.service';
import { devotionalCoordinatorUserIds, longDateLabel, ministryTimeZone } from './common';
import { queueServingNotice, rosterPlaces } from './notify';
import { openRequiredRoles } from './roster.service';

/**
 * `devotional.confirmation_reminders` (docs/05 W8 step 7 and W14 step 4): people who haven't
 * replied hear again 72 and 24 hours before, and coordinators hear about required roles still open
 * within 24 hours. Idempotent through notification dedupe keys.
 */

const HOUR = 3_600_000;
/** Someone told shortly before already has the fresh assignment email: skip the reminder. */
const MIN_NOTICE_72H = 84 * HOUR;
const MIN_NOTICE_24H = 30 * HOUR;

export async function sendServingReminders(db: Database, now: Date) {
  const timeZone = await ministryTimeZone(db);
  const result = { threeDays: 0, oneDay: 0, openRoleNotices: 0 };

  const places = await rosterPlaces(
    db,
    sql`ga.status = 'pending' AND ga.notified_at IS NOT NULL
        AND g.status = 'scheduled' AND g.roster_published_at IS NOT NULL
        AND g.starts_at > ${now.toISOString()}::timestamptz
        AND g.starts_at <= ${new Date(now.getTime() + 72 * HOUR).toISOString()}::timestamptz`,
  );
  for (const place of places) {
    const untilStart = place.startsAt.getTime() - now.getTime();
    const notice = place.startsAt.getTime() - place.notifiedAt!.getTime();
    if (untilStart <= 24 * HOUR) {
      if (notice < MIN_NOTICE_24H) continue;
      if (await queueServingNotice(db, 'devotional.reminder_24h', place, timeZone, `serving_reminder:${place.assignmentId}:24h`)) result.oneDay += 1;
    } else {
      if (notice < MIN_NOTICE_72H) continue;
      if (await queueServingNotice(db, 'devotional.reminder_72h', place, timeZone, `serving_reminder:${place.assignmentId}:72h`)) result.threeDays += 1;
    }
  }

  const soon = await db
    .select({ gathering: gatherings, type: gatheringTypes })
    .from(gatherings)
    .innerJoin(gatheringTypes, eq(gatheringTypes.id, gatherings.gatheringTypeId))
    .where(and(eq(gatherings.status, 'scheduled'), gt(gatherings.startsAt, now), lte(gatherings.startsAt, new Date(now.getTime() + 24 * HOUR))));
  for (const { gathering, type } of soon) {
    const gaps = await openRequiredRoles(db, gathering);
    if (gaps.length === 0) continue;
    const coordinators = await devotionalCoordinatorUserIds(db, type);
    for (const gap of gaps) {
      for (const userId of coordinators) {
        const queued = await queueNotification(db, {
          templateKey: 'devotional.unfilled',
          recipientUserId: userId,
          payload: {
            roleName: gap.roleName,
            gatheringName: gathering.title ?? type.name,
            dateLabel: longDateLabel(gathering.startsAt, timeZone),
            gatheringId: gathering.id,
          },
          dedupeKey: `serving_unfilled:${gathering.id}:${gap.servingRoleId}:${userId}`,
        });
        if (queued) result.openRoleNotices += 1;
      }
    }
  }
  return result;
}
