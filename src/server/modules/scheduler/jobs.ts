import { sendServingReminders } from '../devotional/devotional-jobs.service';
import { generateUpcomingGatherings } from '../devotional/generation.service';
import { ensureJournalLedger } from '../journal/ledger.service';
import { cleanupAbandonedProofs } from '../journal/proof.service';
import { deliverDueNotifications } from '../notifications/delivery.service';
import { generateUpcomingSlots } from '../prayer/generation.service';
import { flagOverdueAssignments, sendSlotReminders } from '../prayer/prayer-jobs.service';
import { cleanupExpiredRecords } from './cleanup.service';
import type { JobDefinition } from './scheduler.service';

/**
 * The background jobs (docs/02 §7). Jobs run on intervals rather than at wall-clock times: each
 * one is idempotent and works from the tick time, so running it more often than the daily time
 * in the table is harmless and catches up after downtime. Within a tick they run in this order,
 * so notifications queued by an earlier job are delivered in the same tick.
 */
export const JOBS: readonly JobDefinition[] = [
  {
    // journal.open_day + journal.resync_day + journal.close_day: days now close on time even
    // when nobody opens the journal (the same function still runs on every journal request).
    key: 'journal.ledger',
    label: 'Opening and closing journal days',
    everyMinutes: 5,
    run: async (db, now) => {
      const result = await ensureJournalLedger(db, now);
      return { opened: result.opened.length, resynced: result.resynced.length, closed: result.closed.length };
    },
  },
  { key: 'prayer.generate_slots', label: 'Creating prayer slots ahead', everyMinutes: 60, run: generateUpcomingSlots },
  { key: 'prayer.check_overdue', label: 'Checking prayer slots nobody finished', everyMinutes: 5, run: flagOverdueAssignments },
  { key: 'prayer.slot_reminders', label: 'Prayer slot reminders', everyMinutes: 5, run: sendSlotReminders },
  { key: 'devotional.generate_gatherings', label: 'Creating gatherings and rosters ahead', everyMinutes: 60, run: generateUpcomingGatherings },
  { key: 'devotional.confirmation_reminders', label: 'Serving reminders', everyMinutes: 15, run: sendServingReminders },
  { key: 'tokens.cleanup', label: 'Clearing expired links and counters', everyMinutes: 24 * 60, run: cleanupExpiredRecords },
  // Photos uploaded by someone who then never sent their journal, and proofs an administrator
  // removed. Only files nobody references: a journal's own proof is kept (docs/03 §9 retention).
  { key: 'journal.proof_cleanup', label: 'Clearing unused journal photos', everyMinutes: 60, run: cleanupAbandonedProofs },
  { key: 'notifications.deliver', label: 'Sending emails and notices', everyMinutes: 1, run: deliverDueNotifications },
];
