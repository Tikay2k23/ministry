/**
 * Notification templates (docs/02 §6). Code-defined for the MVP; the admin template editor
 * (FR-NTF-02) is planned for later. Payloads never contain sensitive content or secrets — a
 * participant's personal action link is created only at send time.
 *
 * Coordination notices are in-app only for now, so nobody gets a 3 AM email; the morning digest
 * with quiet hours arrives with notification preferences (V1).
 */

export interface NotificationContent {
  title: string;
  body: string;
  /** Portal page for in-app and email links (relative, e.g. /app/prayer/…). */
  portalPath?: string;
  actionLabel?: string;
}

export interface TemplateDefinition {
  category: 'prayer' | 'prayer_coordination' | 'devotional' | 'devotional_coordination';
  /** Send by email when the recipient has an address. */
  email: boolean;
  /** A fresh personal link, created at send time, for the assignment in `payload.assignmentId`. */
  actionLink?: 'prayer_assignment' | 'gathering_assignment';
  render(payload: Record<string, unknown>): NotificationContent;
}

const str = (payload: Record<string, unknown>, key: string) => (typeof payload[key] === 'string' ? (payload[key] as string) : '');
const boardPath = (payload: Record<string, unknown>) =>
  `/app/prayer/${str(payload, 'chainId')}${str(payload, 'chainDate') ? `?date=${str(payload, 'chainDate')}` : ''}`;

export const NOTIFICATION_TEMPLATES = {
  'prayer.assigned': {
    category: 'prayer',
    email: true,
    actionLink: 'prayer_assignment',
    render: (p) => ({
      title: 'You’re on the prayer chain',
      body: `You’ve been scheduled to pray in ${str(p, 'chainName')} on ${str(p, 'slotLabel')}. Please let us know you can make it.`,
      actionLabel: 'See my prayer slot',
    }),
  },
  'prayer.slot_reminder_24h': {
    category: 'prayer',
    email: true,
    actionLink: 'prayer_assignment',
    render: (p) => ({
      title: 'Your prayer slot is coming up',
      body: `Your prayer slot in ${str(p, 'chainName')} is ${str(p, 'slotLabel')}. Tap below to confirm.`,
      actionLabel: 'Confirm my slot',
    }),
  },
  'prayer.slot_reminder_30m': {
    category: 'prayer',
    email: true,
    actionLink: 'prayer_assignment',
    render: (p) => ({
      title: 'Your prayer slot starts soon',
      body: `Your prayer slot in ${str(p, 'chainName')} starts soon (${str(p, 'slotLabel')}). Thank you for standing in the gap.`,
      actionLabel: 'Open my prayer slot',
    }),
  },
  'prayer.follow_up_needed': {
    category: 'prayer_coordination',
    email: false,
    render: (p) => ({
      title: 'A prayer slot needs follow-up',
      body: `${str(p, 'personName')}’s slot in ${str(p, 'chainName')} (${str(p, 'slotLabel')}) wasn’t marked finished. Please check in with them gently.`,
      portalPath: boardPath(p),
      actionLabel: 'Open the chain board',
    }),
  },
  'prayer.cannot_make_it': {
    category: 'prayer_coordination',
    email: false,
    render: (p) => ({
      title: 'Someone can’t make their prayer slot',
      body: `${str(p, 'personName')} can’t make their slot in ${str(p, 'chainName')} (${str(p, 'slotLabel')}). Please arrange a substitute.`,
      portalPath: boardPath(p),
      actionLabel: 'Find a substitute',
    }),
  },

  // ─── Devotional / worship (docs/05 W8–W9, W14) ──────────────────────────────
  'devotional.assigned': {
    category: 'devotional',
    email: true,
    actionLink: 'gathering_assignment',
    render: (p) => ({
      title: `You’re serving at ${str(p, 'gatheringName')}`,
      body: `You’re on the roster as ${str(p, 'roleName')} on ${str(p, 'dateLabel')} at ${str(p, 'timeLabel')}. Please let us know if you can serve.`,
      actionLabel: 'Reply about my serving role',
    }),
  },
  'devotional.reminder_72h': {
    category: 'devotional',
    email: true,
    actionLink: 'gathering_assignment',
    render: (p) => ({
      title: 'Can you serve this week?',
      body: `You’re on the roster as ${str(p, 'roleName')} at ${str(p, 'gatheringName')} on ${str(p, 'dateLabel')} at ${str(p, 'timeLabel')}. Please let us know if you can serve.`,
      actionLabel: 'Reply about my serving role',
    }),
  },
  'devotional.reminder_24h': {
    category: 'devotional',
    email: true,
    actionLink: 'gathering_assignment',
    render: (p) => ({
      title: 'Please confirm your serving role',
      body: `You’re serving as ${str(p, 'roleName')} at ${str(p, 'gatheringName')} on ${str(p, 'dateLabel')} at ${str(p, 'timeLabel')}. Please let your coordinator know if you can make it.`,
      actionLabel: 'Reply about my serving role',
    }),
  },
  'devotional.assignment_removed': {
    category: 'devotional',
    email: true,
    render: (p) => ({
      title: 'Your serving role has changed',
      body: `You’re no longer on the roster as ${str(p, 'roleName')} at ${str(p, 'gatheringName')} on ${str(p, 'dateLabel')}. Thank you for your heart to serve!`,
    }),
  },
  'devotional.cancelled': {
    category: 'devotional',
    email: true,
    render: (p) => ({
      title: `${str(p, 'gatheringName')} is cancelled`,
      body: `${str(p, 'gatheringName')} on ${str(p, 'dateLabel')} is cancelled: ${str(p, 'reason')}. Thank you for being ready to serve.`,
    }),
  },
  'devotional.declined': {
    category: 'devotional_coordination',
    email: false,
    render: (p) => ({
      title: 'Someone can’t serve',
      body: `${str(p, 'personName')} can’t serve as ${str(p, 'roleName')} at ${str(p, 'gatheringName')} on ${str(p, 'dateLabel')}. Suggested substitutes are ready.`,
      portalPath: `/app/devotional/${str(p, 'gatheringId')}`,
      actionLabel: 'Find a substitute',
    }),
  },
  'devotional.unfilled': {
    category: 'devotional_coordination',
    email: false,
    render: (p) => ({
      title: 'A serving role is still open',
      body: `${str(p, 'roleName')} for ${str(p, 'gatheringName')} on ${str(p, 'dateLabel')} is still open.`,
      portalPath: `/app/devotional/${str(p, 'gatheringId')}`,
      actionLabel: 'Open the roster',
    }),
  },
} satisfies Record<string, TemplateDefinition>;

export type TemplateKey = keyof typeof NOTIFICATION_TEMPLATES;

export function templateFor(key: string): TemplateDefinition | null {
  return key in NOTIFICATION_TEMPLATES ? NOTIFICATION_TEMPLATES[key as TemplateKey] : null;
}
