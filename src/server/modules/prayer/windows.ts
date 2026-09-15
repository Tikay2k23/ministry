import type { PrayerAssignmentStatus } from '../../db/enums';

/**
 * When a participant may act on their prayer slot (BR-PR-02, BR-PR-03). Pure, so the rules are
 * shared by the public pages, the services and the tests.
 *
 * - Confirm: any time before the slot starts.
 * - "I'm praying now": from `checkinOpensMinutes` before the start until the end.
 * - "I've finished": from the start; after end + grace it is still accepted but flagged late.
 *   Chains that require check-in ask for it first while the slot is running.
 * - "I can't make it": before the slot ends, while nothing has been done yet.
 * - The optional report: once completed, for a week.
 */

export type PrayerAction = 'confirm' | 'check_in' | 'complete' | 'cannot_make_it' | 'report';

export interface AssignmentTiming {
  status: PrayerAssignmentStatus;
  startsAt: Date;
  endsAt: Date;
  graceMinutes: number;
  checkinOpensMinutes: number;
  requireCheckin: boolean;
  hasReport: boolean;
  reportFormAvailable: boolean;
}

export interface ActionWindow {
  allowed: boolean;
  opensAt?: Date;
  closesAt?: Date;
}

const REPORT_DAYS = 7;
const COMPLETABLE: readonly PrayerAssignmentStatus[] = ['scheduled', 'confirmed', 'in_prayer', 'needs_follow_up'];

export function actionWindow(action: PrayerAction, a: AssignmentTiming, now: Date): ActionWindow {
  const t = now.getTime();
  const start = a.startsAt.getTime();
  const end = a.endsAt.getTime();
  const notStarted = a.status === 'scheduled' || a.status === 'confirmed';

  switch (action) {
    case 'confirm':
      return { allowed: a.status === 'scheduled' && t < start, closesAt: a.startsAt };
    case 'check_in': {
      const opensAt = new Date(start - a.checkinOpensMinutes * 60_000);
      return { allowed: notStarted && t >= opensAt.getTime() && t <= end, opensAt, closesAt: a.endsAt };
    }
    case 'complete': {
      const waitingForCheckIn = a.requireCheckin && notStarted && t <= end;
      return { allowed: COMPLETABLE.includes(a.status) && t >= start && !waitingForCheckIn, opensAt: a.startsAt };
    }
    case 'cannot_make_it':
      return { allowed: notStarted && t < end, closesAt: a.endsAt };
    case 'report': {
      const closesAt = new Date(end + REPORT_DAYS * 86_400_000);
      return { allowed: a.status === 'completed' && !a.hasReport && a.reportFormAvailable && t <= closesAt.getTime(), closesAt };
    }
  }
}

/** Completion after end + grace is accepted but flagged late (BR-PR-03). */
export function isLateCompletion(a: Pick<AssignmentTiming, 'endsAt' | 'graceMinutes'>, now: Date): boolean {
  return now.getTime() > a.endsAt.getTime() + a.graceMinutes * 60_000;
}

/** The one main button for this moment (docs/04 P7): confirm → I'm praying now → I've finished. */
export function primaryAction(a: AssignmentTiming, now: Date): Exclude<PrayerAction, 'cannot_make_it' | 'report'> | null {
  if (a.status === 'in_prayer') return 'complete';
  if (actionWindow('check_in', a, now).allowed) return 'check_in';
  if (actionWindow('complete', a, now).allowed) return 'complete';
  if (actionWindow('confirm', a, now).allowed) return 'confirm';
  return null;
}
