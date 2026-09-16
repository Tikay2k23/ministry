import { sql, type SQL } from 'drizzle-orm';
import { queryRows, type Executor } from '../../db/client';
import type { GatheringAssignmentStatus } from '../../db/enums';
import { queueNotification } from '../notifications/notifications.service';
import type { TemplateKey } from '../notifications/templates';
import { clockLabel, longDateLabel } from './common';

/**
 * Serving notices to the person on a roster (docs/05 W8 steps 6 and 8, W9 step 4). Payloads carry
 * names and dates only; a personal link is added when the email is sent.
 */

export interface RosterPlace {
  assignmentId: string;
  personId: string;
  status: GatheringAssignmentStatus;
  notifiedAt: Date | null;
  roleName: string;
  gatheringId: string;
  gatheringName: string;
  startsAt: Date;
}

/** Roster places matching `where` (use the aliases ga, g, gt, sr). */
export async function rosterPlaces(executor: Executor, where: SQL): Promise<RosterPlace[]> {
  const rows = await queryRows<{
    assignment_id: string;
    person_id: string;
    status: GatheringAssignmentStatus;
    notified_at: Date | string | null;
    role_name: string;
    gathering_id: string;
    gathering_name: string;
    starts_at: Date | string;
  }>(
    executor,
    sql`SELECT ga.id AS assignment_id, ga.person_id, ga.status, ga.notified_at, sr.name AS role_name,
               g.id AS gathering_id, coalesce(g.title, gt.name) AS gathering_name, g.starts_at
          FROM gathering_assignments ga
          JOIN serving_roles sr ON sr.id = ga.serving_role_id
          JOIN gatherings g ON g.id = ga.gathering_id
          JOIN gathering_types gt ON gt.id = g.gathering_type_id
         WHERE ${where}
         ORDER BY g.starts_at, sr.sort_order`,
  );
  return rows.map((row) => ({
    assignmentId: row.assignment_id,
    personId: row.person_id,
    status: row.status,
    notifiedAt: row.notified_at ? new Date(row.notified_at) : null,
    roleName: row.role_name,
    gatheringId: row.gathering_id,
    gatheringName: row.gathering_name,
    startsAt: new Date(row.starts_at),
  }));
}

export function servingPayload(place: RosterPlace, timeZone: string, extra: Record<string, string> = {}) {
  return {
    assignmentId: place.assignmentId,
    gatheringId: place.gatheringId,
    gatheringName: place.gatheringName,
    roleName: place.roleName,
    dateLabel: longDateLabel(place.startsAt, timeZone),
    timeLabel: clockLabel(place.startsAt, timeZone),
    ...extra,
  };
}

export async function queueServingNotice(
  executor: Executor,
  templateKey: TemplateKey,
  place: RosterPlace,
  timeZone: string,
  dedupeKey: string,
  extra: Record<string, string> = {},
): Promise<boolean> {
  return queueNotification(executor, {
    templateKey,
    recipientPersonId: place.personId,
    payload: servingPayload(place, timeZone, extra),
    dedupeKey,
  });
}
