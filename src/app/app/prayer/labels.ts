import type { PrayerAssignmentStatus, PrayerChainStatus, PrayerChainType } from '@/server/db/enums';

/** Words for the prayer chain pages. People are never shown in red (docs/04 principles). */

type Tone = 'neutral' | 'green' | 'amber' | 'slate';

export const CHAIN_TYPE_LABELS: Record<PrayerChainType, string> = {
  continuous: 'Around the clock',
  scheduled_blocks: 'Scheduled blocks',
  event: 'One-time event',
};

export const CHAIN_STATUS: Record<PrayerChainStatus, { label: string; tone: Tone }> = {
  draft: { label: 'Not started', tone: 'neutral' },
  active: { label: 'Active', tone: 'green' },
  paused: { label: 'Paused', tone: 'amber' },
  ended: { label: 'Ended', tone: 'slate' },
};

export const ASSIGNMENT_STATUS: Record<PrayerAssignmentStatus, { label: string; tone: Tone }> = {
  scheduled: { label: 'Upcoming', tone: 'neutral' },
  confirmed: { label: 'Confirmed', tone: 'slate' },
  in_prayer: { label: 'Praying now', tone: 'green' },
  completed: { label: 'Finished', tone: 'green' },
  needs_follow_up: { label: 'Needs follow-up', tone: 'amber' },
  missed: { label: 'Missed', tone: 'neutral' },
  excused: { label: 'Excused', tone: 'neutral' },
  replaced: { label: 'Replaced', tone: 'neutral' },
  cancelled: { label: 'Removed', tone: 'neutral' },
};
