import { cn } from '@/lib/cn';

/**
 * Journal status vocabulary for the portal (docs/04 §2 status tokens). Always a word next
 * to the colour, and gentle labels: "Not yet" and "No journal", never "failed".
 */

export type JournalDayStatus = 'pending' | 'submitted' | 'late' | 'missed' | 'excused';

export const JOURNAL_STATUS: Record<JournalDayStatus, { label: string; dot: string; text: string }> = {
  submitted: { label: 'Received', dot: 'bg-status-received', text: 'text-status-received' },
  late: { label: 'Received late', dot: 'bg-status-late', text: 'text-status-late' },
  pending: { label: 'Not yet', dot: 'bg-status-notyet', text: 'text-muted' },
  missed: { label: 'No journal', dot: 'bg-status-missed', text: 'text-status-missed' },
  excused: { label: 'Excused', dot: 'bg-status-excused', text: 'text-status-excused' },
};

export const EXCUSE_LABEL: Record<string, string> = {
  rest_day: 'Rest day',
  pause: 'On a pause',
  leader_excused: 'Excused by a leader',
  admin_excused: 'Excused by the office',
};

export function JournalStatus({ status, className }: { status: JournalDayStatus; className?: string }) {
  const { label, dot, text } = JOURNAL_STATUS[status];
  return (
    <span className={cn('inline-flex items-center gap-1.5 text-sm font-medium whitespace-nowrap', text, className)}>
      <span aria-hidden className={cn('size-2.5 rounded-full', dot)} />
      {label}
    </span>
  );
}

/** A row of small dots, oldest first. Empty ring = no record for that day (not expected yet). */
export function DayDots({ days, size = 'sm' }: { days: { date: string; status: JournalDayStatus | null }[]; size?: 'sm' | 'md' }) {
  const describe = (d: { date: string; status: JournalDayStatus | null }) =>
    `${formatDayLabel(d.date, 'short')}: ${d.status ? JOURNAL_STATUS[d.status].label : 'no record'}`;
  return (
    <span role="img" aria-label={days.map(describe).join('; ')} className={cn('inline-flex flex-wrap items-center', size === 'sm' ? 'gap-1' : 'gap-1.5')}>
      {days.map((d) => (
        <span
          key={d.date}
          title={describe(d)}
          className={cn(
            'rounded-full',
            size === 'sm' ? 'size-2.5' : 'size-3.5',
            d.status ? JOURNAL_STATUS[d.status].dot : 'border border-line-strong',
          )}
        />
      ))}
    </span>
  );
}

/** "Tuesday, September 15" for a YYYY-MM-DD journal date (no timezone shifting). */
export function formatDayLabel(date: string, style: 'long' | 'short' = 'long'): string {
  return new Intl.DateTimeFormat('en-PH', {
    weekday: style === 'long' ? 'long' : 'short',
    month: style === 'long' ? 'long' : 'short',
    day: 'numeric',
    timeZone: 'UTC',
  }).format(new Date(`${date}T12:00:00Z`));
}

export function formatClock(value: Date | string, timeZone: string): string {
  return new Intl.DateTimeFormat('en-PH', { hour: 'numeric', minute: '2-digit', timeZone }).format(new Date(value));
}
