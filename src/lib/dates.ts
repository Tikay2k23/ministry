/** Date helpers that always render in the ministry timezone (docs/01 NFR "Time"). */

export function formatLongDate(date: Date, timeZone: string, locale = 'en-PH'): string {
  return new Intl.DateTimeFormat(locale, { weekday: 'long', month: 'long', day: 'numeric', timeZone }).format(date);
}

export function formatDateTime(date: Date, timeZone: string, locale = 'en-PH'): string {
  return new Intl.DateTimeFormat(locale, {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    timeZone,
  }).format(date);
}

/** "Good morning" / "Good afternoon" / "Good evening" for the local hour in `timeZone`. */
export function greeting(date: Date, timeZone: string): string {
  const hour = Number(new Intl.DateTimeFormat('en-US', { hour: 'numeric', hourCycle: 'h23', timeZone }).format(date));
  if (hour < 12) return 'Good morning';
  if (hour < 18) return 'Good afternoon';
  return 'Good evening';
}
