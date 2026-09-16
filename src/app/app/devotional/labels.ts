import type { GatheringAssignmentStatus, GatheringStatus } from '@/server/db/enums';

/** Words for the devotional pages. People are never shown in red (docs/04 principles). */

type Tone = 'neutral' | 'green' | 'amber' | 'slate';

export const GATHERING_STATUS: Record<GatheringStatus, { label: string; tone: Tone }> = {
  scheduled: { label: 'Scheduled', tone: 'green' },
  cancelled: { label: 'Cancelled', tone: 'slate' },
  completed: { label: 'Completed', tone: 'neutral' },
};

export const ASSIGNMENT_TONE: Record<GatheringAssignmentStatus, Tone> = {
  pending: 'neutral',
  confirmed: 'green',
  declined: 'amber',
  replaced: 'slate',
  cancelled: 'slate',
};

/** "(1 needed)", "(2 needed)", "(optional)", "(1–2)". */
export function neededLabel(role: { inTemplate: boolean; minCount: number; maxCount: number }): string {
  if (!role.inTemplate) return '(added to this roster)';
  if (role.minCount === 0) return role.maxCount === 1 ? '(optional)' : `(optional, up to ${role.maxCount})`;
  return role.minCount === role.maxCount ? `(${role.minCount} needed)` : `(${role.minCount}–${role.maxCount})`;
}
