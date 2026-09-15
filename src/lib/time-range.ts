/** "21:00" or "21:00:00" → "9:00 PM" (a wall-clock time, no time zone involved). */
export function formatClockTime(time: string): string {
  const [hours = 0, minutes = 0] = time.split(':').map(Number);
  const hour = hours % 12 === 0 ? 12 : hours % 12;
  return `${hour}:${String(minutes).padStart(2, '0')} ${hours < 12 ? 'AM' : 'PM'}`;
}

/**
 * Human time ranges for prayer slots (docs/01 E11): "2:00 – 3:00 AM" style, with both dates when
 * a slot crosses midnight. A slot ending exactly at midnight counts as the same day.
 */
export function formatSlotRange(startsAt: Date | string, endsAt: Date | string, timeZone: string, options: { withDate?: boolean } = {}): string {
  const start = new Date(startsAt);
  const end = new Date(endsAt);
  const dayKey = (d: Date) => new Intl.DateTimeFormat('en-CA', { year: 'numeric', month: '2-digit', day: '2-digit', timeZone }).format(d);
  const clock = (d: Date) => new Intl.DateTimeFormat('en-PH', { hour: 'numeric', minute: '2-digit', timeZone }).format(d);
  const day = (d: Date) => new Intl.DateTimeFormat('en-PH', { weekday: 'short', month: 'short', day: 'numeric', timeZone }).format(d);

  const crossesMidnight = dayKey(start) !== dayKey(new Date(end.getTime() - 1));
  if (crossesMidnight) return `${day(start)}, ${clock(start)} – ${day(end)}, ${clock(end)}`;
  const range = `${clock(start)} – ${clock(end)}`;
  return options.withDate ? `${day(start)}, ${range}` : range;
}
