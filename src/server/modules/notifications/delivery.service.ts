import { and, eq, sql } from 'drizzle-orm';
import { queryRows, type Database } from '../../db/client';
import { notificationDeliveries, notifications, people, users } from '../../db/schema';
import { getEmailProvider } from '../../email/email';
import { notificationEmail } from '../../email/templates';
import { getEnv } from '../../env';
import { errorSummary, logger } from '../../logger';
import { issueServingActionLink } from '../devotional/action-links.service';
import { issuePrayerActionLink } from '../prayer/action-links.service';
import { templateFor } from './templates';

/**
 * The `notifications.deliver` job (docs/02 §6). Claims due notifications with SKIP LOCKED, sends
 * email where the template allows and the recipient has an address, and retries failures with
 * backoff (1 m, 5 m, 30 m, then gives up). Portal recipients always see the notification in-app.
 */

const BATCH_SIZE = 50;
const RETRY_MINUTES = [1, 5, 30] as const;

type Outcome = 'sent' | 'suppressed' | 'retrying' | 'failed';

interface ClaimedRow {
  id: string;
  template_key: string;
  recipient_person_id: string | null;
  recipient_user_id: string | null;
  payload: Record<string, unknown>;
  attempts: number;
}

export function maskEmail(email: string): string {
  const [name = '', domain = ''] = email.split('@');
  return `${name.charAt(0)}•••@${domain}`;
}

async function recipientEmail(db: Database, row: ClaimedRow): Promise<string | null> {
  if (row.recipient_user_id) {
    const [user] = await db.select({ email: users.email, status: users.status }).from(users).where(eq(users.id, row.recipient_user_id));
    return user && (user.status === 'active' || user.status === 'invited') ? user.email : null;
  }
  if (row.recipient_person_id) {
    const [person] = await db
      .select({ email: people.email, archivedAt: people.archivedAt })
      .from(people)
      .where(eq(people.id, row.recipient_person_id));
    return person && !person.archivedAt ? person.email : null;
  }
  return null;
}

async function deliverOne(db: Database, row: ClaimedRow, now: Date): Promise<Outcome> {
  const finish = (values: Partial<typeof notifications.$inferInsert>) =>
    db.update(notifications).set(values).where(eq(notifications.id, row.id));

  const template = templateFor(row.template_key);
  if (!template) {
    await finish({ status: 'failed', lastError: `Unknown template ${row.template_key}` });
    return 'failed';
  }

  const email = template.email ? await recipientEmail(db, row) : null;
  if (!email) {
    if (row.recipient_user_id) {
      await finish({ status: 'sent', sentAt: now }); // in-app only
      return 'sent';
    }
    await finish({ status: 'suppressed', suppressedReason: 'no_channel' });
    return 'suppressed';
  }

  let url: string | null = null;
  const content = template.render(row.payload);
  if (template.actionLink) {
    const assignmentId = typeof row.payload.assignmentId === 'string' ? row.payload.assignmentId : null;
    const link = !assignmentId
      ? null
      : template.actionLink === 'gathering_assignment'
        ? await issueServingActionLink(db, assignmentId, now)
        : await issuePrayerActionLink(db, assignmentId, now);
    if (!link) {
      await finish({ status: 'suppressed', suppressedReason: 'no_longer_relevant' });
      return 'suppressed';
    }
    url = link.url;
  } else if (content.portalPath) {
    url = `${getEnv().APP_URL}${content.portalPath}`;
  }

  const [existing] = await db
    .select({ id: notificationDeliveries.id })
    .from(notificationDeliveries)
    .where(and(eq(notificationDeliveries.notificationId, row.id), eq(notificationDeliveries.channel, 'email')));
  const deliveryId =
    existing?.id ??
    (
      await db
        .insert(notificationDeliveries)
        .values({ notificationId: row.id, channel: 'email', provider: getEnv().EMAIL_PROVIDER, destinationMasked: maskEmail(email) })
        .returning({ id: notificationDeliveries.id })
    )[0]!.id;

  const attempts = row.attempts + 1;
  try {
    await getEmailProvider().send(notificationEmail(email, content.title, content.body, url ? { url, label: content.actionLabel ?? 'Open' } : null));
    await db
      .update(notificationDeliveries)
      .set({ status: 'sent', sentAt: now, attempts, lastError: null })
      .where(eq(notificationDeliveries.id, deliveryId));
    await finish({ status: 'sent', sentAt: now, attempts, lastError: null });
    return 'sent';
  } catch (error) {
    const message = errorSummary(error);
    await db
      .update(notificationDeliveries)
      .set({ status: 'failed', attempts, lastError: message })
      .where(eq(notificationDeliveries.id, deliveryId));
    const retryIn = RETRY_MINUTES[attempts - 1];
    if (retryIn === undefined) {
      await finish({ status: 'failed', attempts, lastError: message });
      return 'failed';
    }
    await finish({ status: 'pending', attempts, lastError: message, scheduledFor: new Date(now.getTime() + retryIn * 60_000) });
    return 'retrying';
  }
}

export async function deliverDueNotifications(db: Database, now: Date) {
  const claimed = await queryRows<ClaimedRow>(
    db,
    sql`UPDATE notifications SET status = 'processing'
         WHERE id IN (SELECT id FROM notifications
                       WHERE status = 'pending' AND scheduled_for <= ${now.toISOString()}::timestamptz
                       ORDER BY scheduled_for
                       LIMIT ${BATCH_SIZE}
                       FOR UPDATE SKIP LOCKED)
     RETURNING id, template_key, recipient_person_id, recipient_user_id, payload, attempts`,
  );
  const summary: Record<Outcome, number> & { claimed: number } = { claimed: claimed.length, sent: 0, suppressed: 0, retrying: 0, failed: 0 };
  for (const row of claimed) {
    try {
      summary[await deliverOne(db, row, now)] += 1;
    } catch (error) {
      // Never leave a notification stuck in "processing".
      logger.error('Notification delivery crashed', error, { notificationId: row.id });
      await db
        .update(notifications)
        .set({ status: 'pending', attempts: row.attempts + 1, scheduledFor: new Date(now.getTime() + 5 * 60_000) })
        .where(eq(notifications.id, row.id));
      summary.retrying += 1;
    }
  }
  return summary;
}
