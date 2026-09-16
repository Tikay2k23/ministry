import { inArray, sql } from 'drizzle-orm';
import { formatSlotRange } from '@/lib/time-range';
import { queryRows, type Database, type Executor } from '../../db/client';
import { careFollowups, users } from '../../db/schema';
import type { ChainRef } from '../../policy/can';
import { queueNotification } from '../notifications/notifications.service';
import { prayerFollowUpKey, recordPrayerEvent } from './common';
import { coordinatorUserIds } from './coordinators.service';

/**
 * The prayer chain's background jobs (docs/02 §7): reminders before a slot, and a gentle
 * follow-up when a slot ended without "I've finished praying". Both are idempotent: reminders by
 * notification dedupe key, follow-ups by a status change that only touches unfinished assignments.
 */

const BATCH_SIZE = 500;
const DAY_BEFORE_MS = 24 * 3_600_000;
const SOON_MS = 30 * 60_000;
/** Someone assigned shortly before their slot already has the assignment email: skip the reminder. */
const DAY_BEFORE_MIN_NOTICE_MS = 20 * 3_600_000;
const SOON_MIN_NOTICE_MS = 40 * 60_000;

interface ReminderRow {
  id: string;
  person_id: string;
  status: string;
  starts_at: Date | string;
  ends_at: Date | string;
  created_at: Date | string;
  chain_name: string;
  timezone: string;
}

/** `prayer.slot_reminders` (docs/05 W12 steps 1 and 3): a day before, to confirm, and 30 minutes before. */
export async function sendSlotReminders(db: Database, now: Date) {
  const nowIso = now.toISOString();
  const rows = await queryRows<ReminderRow>(
    db,
    sql`SELECT a.id, a.person_id, a.status, a.starts_at, a.ends_at, a.created_at, c.name AS chain_name, c.timezone
          FROM prayer_assignments a
          JOIN prayer_slots s ON s.id = a.slot_id AND s.status = 'open'
          JOIN prayer_chains c ON c.id = s.prayer_chain_id AND c.status = 'active' AND c.archived_at IS NULL
         WHERE a.status IN ('scheduled', 'confirmed')
           AND a.starts_at > ${nowIso}::timestamptz
           AND a.starts_at <= ${nowIso}::timestamptz + interval '24 hours'
         ORDER BY a.starts_at
         LIMIT ${BATCH_SIZE}`,
  );

  const sent = { dayBefore: 0, soon: 0 };
  for (const row of rows) {
    const startsAt = new Date(row.starts_at);
    const notice = startsAt.getTime() - new Date(row.created_at).getTime();
    const payload = {
      chainName: row.chain_name,
      slotLabel: formatSlotRange(startsAt, new Date(row.ends_at), row.timezone, { withDate: true }),
      assignmentId: row.id,
    };
    if (startsAt.getTime() - now.getTime() <= SOON_MS) {
      if (notice < SOON_MIN_NOTICE_MS) continue;
      const queued = await queueNotification(db, {
        templateKey: 'prayer.slot_reminder_30m',
        recipientPersonId: row.person_id,
        payload,
        dedupeKey: `prayer_slot_reminder:${row.id}:30m`,
      });
      if (queued) sent.soon += 1;
    } else if (row.status === 'scheduled' && startsAt.getTime() - now.getTime() <= DAY_BEFORE_MS) {
      if (notice < DAY_BEFORE_MIN_NOTICE_MS) continue;
      const queued = await queueNotification(db, {
        templateKey: 'prayer.slot_reminder_24h',
        recipientPersonId: row.person_id,
        payload,
        dedupeKey: `prayer_slot_reminder:${row.id}:24h`,
      });
      if (queued) sent.dayBefore += 1;
    }
  }
  return sent;
}

interface FlaggedRow {
  id: string;
  person_id: string;
  previous_status: string;
  starts_at: Date | string;
  ends_at: Date | string;
  chain_date: string;
  chain_id: string;
  ministry_id: string | null;
  chain_name: string;
  timezone: string;
  first_name: string;
  last_name: string;
  preferred_name: string | null;
}

async function coordinatorsOf(executor: Executor, chain: ChainRef, cache: Map<string, { userIds: string[]; personId: string | null }>) {
  const cached = cache.get(chain.id);
  if (cached) return cached;
  const userIds = await coordinatorUserIds(executor, chain);
  const accounts = userIds.length > 0 ? await executor.select({ personId: users.personId }).from(users).where(inArray(users.id, userIds)) : [];
  const result = { userIds, personId: accounts.find((a) => a.personId)?.personId ?? null };
  cache.set(chain.id, result);
  return result;
}

/**
 * `prayer.check_overdue` (docs/05 W13): once end + grace has passed without "I've finished
 * praying", the assignment needs follow-up. The chain's coordinator gets a care follow-up and an
 * in-app notice. Nothing is ever marked missed here — only a coordinator decides that (BR-PR-04).
 */
export async function flagOverdueAssignments(db: Database, now: Date) {
  const nowIso = now.toISOString();
  return db.transaction(async (tx) => {
    const flagged = await queryRows<FlaggedRow>(
      tx,
      sql`WITH due AS (
            SELECT a.id, a.status AS previous_status
              FROM prayer_assignments a
              JOIN prayer_slots s ON s.id = a.slot_id AND s.status = 'open'
              JOIN prayer_chains c ON c.id = s.prayer_chain_id
             WHERE a.status IN ('scheduled', 'confirmed', 'in_prayer')
               AND a.ends_at + make_interval(mins => c.grace_minutes) < ${nowIso}::timestamptz
             ORDER BY a.ends_at
             LIMIT ${BATCH_SIZE}
             FOR UPDATE OF a SKIP LOCKED
          )
          UPDATE prayer_assignments AS a
             SET status = 'needs_follow_up', updated_at = ${nowIso}::timestamptz
            FROM due, prayer_slots s, prayer_chains c, people p
           WHERE a.id = due.id AND s.id = a.slot_id AND c.id = s.prayer_chain_id AND p.id = a.person_id
          RETURNING a.id, a.person_id, due.previous_status, a.starts_at, a.ends_at, s.chain_date::text AS chain_date,
                    c.id AS chain_id, c.ministry_id, c.name AS chain_name, c.timezone, p.first_name, p.last_name, p.preferred_name`,
    );

    const cache = new Map<string, { userIds: string[]; personId: string | null }>();
    let notices = 0;
    for (const row of flagged) {
      const checkedIn = row.previous_status === 'in_prayer';
      const slotLabel = formatSlotRange(new Date(row.starts_at), new Date(row.ends_at), row.timezone, { withDate: true });
      const coordinators = await coordinatorsOf(tx, { id: row.chain_id, ministryId: row.ministry_id }, cache);

      await recordPrayerEvent(tx, {
        assignmentId: row.id,
        eventType: 'flagged_follow_up',
        actor: { type: 'system' },
        via: 'job',
        at: now,
        note: checkedIn ? 'Checked in, but not marked finished' : null,
      });
      await tx
        .insert(careFollowups)
        .values({
          personId: row.person_id,
          kind: 'prayer_unconfirmed',
          sourceType: 'prayer_assignment',
          sourceRef: row.id,
          assignedToPersonId: coordinators.personId,
          summary: `${checkedIn ? 'Checked in but didn’t mark finished' : 'Prayer slot not marked finished'}: ${row.chain_name}, ${slotLabel}`,
          dedupeKey: prayerFollowUpKey(row.id),
        })
        .onConflictDoNothing({ target: careFollowups.dedupeKey });

      const personName = `${row.preferred_name ?? row.first_name} ${row.last_name.charAt(0)}.`;
      for (const userId of coordinators.userIds) {
        const queued = await queueNotification(tx, {
          templateKey: 'prayer.follow_up_needed',
          recipientUserId: userId,
          payload: { personName, chainName: row.chain_name, slotLabel, chainId: row.chain_id, chainDate: row.chain_date },
          dedupeKey: `${prayerFollowUpKey(row.id)}:${userId}`,
        });
        if (queued) notices += 1;
      }
    }
    return { flagged: flagged.length, coordinatorNotices: notices };
  });
}
