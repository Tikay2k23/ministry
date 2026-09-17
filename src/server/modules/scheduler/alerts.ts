import { sql } from 'drizzle-orm';
import { queryRows, type Executor } from '../../db/client';
import { queueNotification } from '../notifications/notifications.service';

/**
 * Alerting (docs/07 M5): when a background job fails, the people who run the system hear about it
 * in their inbox and by email, at most once a day per job, instead of finding out from members.
 * The message carries the error summary only, which never holds personal data (src/server/logger.ts).
 */

/** Users with a global `settings.manage` grant: the system's administrators, including a seeded one who hasn't signed in yet. */
export async function systemAdministratorUserIds(executor: Executor): Promise<string[]> {
  const rows = await queryRows<{ user_id: string }>(
    executor,
    sql`SELECT DISTINCT ura.user_id
          FROM user_role_assignments ura
          JOIN roles r ON r.id = ura.role_id AND r.archived_at IS NULL
          JOIN role_permissions rp ON rp.role_id = ura.role_id AND rp.permission_key = 'settings.manage'
          JOIN users u ON u.id = ura.user_id AND u.status IN ('active', 'invited')
         WHERE ura.revoked_at IS NULL
           AND (ura.expires_at IS NULL OR ura.expires_at > now())
           AND ura.scope_type = 'global'`,
  );
  return rows.map((row) => row.user_id);
}

export async function alertJobFailure(
  executor: Executor,
  job: { key: string; label: string },
  errorMessage: string,
  now: Date,
): Promise<number> {
  const day = now.toISOString().slice(0, 10);
  let queued = 0;
  for (const userId of await systemAdministratorUserIds(executor)) {
    const added = await queueNotification(executor, {
      templateKey: 'system.job_failed',
      recipientUserId: userId,
      payload: { jobLabel: job.label, error: errorMessage },
      dedupeKey: `system_job_failed:${job.key}:${userId}:${day}`,
    });
    if (added) queued += 1;
  }
  return queued;
}
