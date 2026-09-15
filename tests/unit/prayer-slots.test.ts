import { describe, expect, it } from 'vitest';
import { formatSlotRange } from '@/lib/time-range';
import { isValidTimeZone, slotsForOccurrence } from '@/server/modules/prayer/slot-times';
import { actionWindow, isLateCompletion, primaryAction, type AssignmentTiming } from '@/server/modules/prayer/windows';

const TZ = 'Asia/Manila';
const normalise = (s: string) => s.replace(/\s/g, ' ');

describe('prayer slot times', () => {
  it('builds a 24-hour chain in the chain’s time zone', () => {
    const slots = slotsForOccurrence('2026-09-15', { firstSlotTime: '00:00:00', slotMinutes: 60, slotsPerOccurrence: 24 }, TZ);
    expect(slots).toHaveLength(24);
    expect(slots[0]!.startsAt.toISOString()).toBe('2026-09-14T16:00:00.000Z');
    expect(slots[23]!.endsAt.toISOString()).toBe('2026-09-15T16:00:00.000Z');
    expect(new Set(slots.map((s) => s.chainDate))).toEqual(new Set(['2026-09-15']));
  });

  it('dates slots after midnight by their own start (BR-PR-06)', () => {
    const vigil = slotsForOccurrence('2026-09-18', { firstSlotTime: '21:00', slotMinutes: 30, slotsPerOccurrence: 18 }, TZ);
    expect(vigil[0]!.chainDate).toBe('2026-09-18');
    expect(vigil[5]!.chainDate).toBe('2026-09-18'); // 11:30 PM – midnight
    expect(vigil[6]!.chainDate).toBe('2026-09-19'); // midnight – 12:30 AM
    expect(vigil.at(-1)!.endsAt.toISOString()).toBe('2026-09-18T22:00:00.000Z'); // 6:00 AM Saturday
  });

  it('shows both dates only when a slot really crosses midnight', () => {
    const [late] = slotsForOccurrence('2026-09-18', { firstSlotTime: '23:30', slotMinutes: 30, slotsPerOccurrence: 1 }, TZ);
    expect(normalise(formatSlotRange(late!.startsAt, late!.endsAt, TZ))).toMatch(/^11:30 PM – 12:00 AM$/i);
    const [crossing] = slotsForOccurrence('2026-09-18', { firstSlotTime: '23:30', slotMinutes: 60, slotsPerOccurrence: 1 }, TZ);
    const label = normalise(formatSlotRange(crossing!.startsAt, crossing!.endsAt, TZ));
    expect(label).toContain('Fri');
    expect(label).toContain('Sat');
  });

  it('validates time zones', () => {
    expect(isValidTimeZone('Asia/Manila')).toBe(true);
    expect(isValidTimeZone('Mars/Olympus')).toBe(false);
  });
});

describe('participant action windows', () => {
  const slot: AssignmentTiming = {
    status: 'scheduled',
    startsAt: new Date('2026-09-15T18:00:00Z'),
    endsAt: new Date('2026-09-15T19:00:00Z'),
    graceMinutes: 15,
    checkinOpensMinutes: 15,
    requireCheckin: false,
    hasReport: false,
    reportFormAvailable: true,
  };
  const at = (iso: string) => new Date(iso);

  it('follows the confirmation, check-in and completion windows (BR-PR-02, BR-PR-03)', () => {
    expect(actionWindow('confirm', slot, at('2026-09-15T17:59:00Z')).allowed).toBe(true);
    expect(actionWindow('confirm', slot, at('2026-09-15T18:00:00Z')).allowed).toBe(false);
    expect(actionWindow('check_in', slot, at('2026-09-15T17:44:59Z')).allowed).toBe(false);
    expect(actionWindow('check_in', slot, at('2026-09-15T17:45:00Z')).allowed).toBe(true);
    expect(actionWindow('check_in', slot, at('2026-09-15T19:00:01Z')).allowed).toBe(false);
    expect(actionWindow('complete', slot, at('2026-09-15T17:59:00Z')).allowed).toBe(false);
    expect(actionWindow('complete', { ...slot, status: 'needs_follow_up' }, at('2026-09-16T01:00:00Z')).allowed).toBe(true);
    expect(actionWindow('complete', { ...slot, status: 'missed' }, at('2026-09-15T18:30:00Z')).allowed).toBe(false);
    expect(actionWindow('cannot_make_it', { ...slot, status: 'in_prayer' }, at('2026-09-15T18:30:00Z')).allowed).toBe(false);
    expect(isLateCompletion(slot, at('2026-09-15T19:15:00Z'))).toBe(false);
    expect(isLateCompletion(slot, at('2026-09-15T19:15:01Z'))).toBe(true);
  });

  it('shows one main action for the moment', () => {
    expect(primaryAction(slot, at('2026-09-15T10:00:00Z'))).toBe('confirm');
    expect(primaryAction({ ...slot, status: 'confirmed' }, at('2026-09-15T10:00:00Z'))).toBeNull();
    expect(primaryAction({ ...slot, status: 'confirmed' }, at('2026-09-15T17:50:00Z'))).toBe('check_in');
    expect(primaryAction({ ...slot, status: 'in_prayer' }, at('2026-09-15T18:20:00Z'))).toBe('complete');
    expect(primaryAction(slot, at('2026-09-15T19:30:00Z'))).toBe('complete');
    expect(primaryAction({ ...slot, status: 'completed' }, at('2026-09-15T19:30:00Z'))).toBeNull();
  });

  it('asks for check-in first when the chain requires it, while the slot is running', () => {
    const strict = { ...slot, requireCheckin: true, status: 'confirmed' as const };
    expect(actionWindow('complete', strict, at('2026-09-15T18:30:00Z')).allowed).toBe(false);
    expect(actionWindow('complete', strict, at('2026-09-15T19:05:00Z')).allowed).toBe(true);
    expect(actionWindow('complete', { ...strict, status: 'in_prayer' }, at('2026-09-15T18:30:00Z')).allowed).toBe(true);
  });

  it('offers the optional report for a week after a completed slot', () => {
    const done = { ...slot, status: 'completed' as const };
    expect(actionWindow('report', done, at('2026-09-22T19:00:00Z')).allowed).toBe(true);
    expect(actionWindow('report', done, at('2026-09-22T19:00:01Z')).allowed).toBe(false);
    expect(actionWindow('report', { ...done, hasReport: true }, at('2026-09-15T19:30:00Z')).allowed).toBe(false);
    expect(actionWindow('report', { ...done, reportFormAvailable: false }, at('2026-09-15T19:30:00Z')).allowed).toBe(false);
  });
});
