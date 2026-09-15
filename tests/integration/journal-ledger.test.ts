import { and, eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { DatabaseHandle } from '@/server/db/client';
import { careFollowups, journalDays, journalLedgerRuns, journalPauses, ministryCalendarDays } from '@/server/db/schema';
import { movePerson } from '@/server/modules/hierarchy/hierarchy.service';
import { zonedInstant } from '@/server/modules/journal/journal-dates';
import { ensureJournalLedger } from '@/server/modules/journal/ledger.service';
import { archivePerson } from '@/server/modules/people/people.service';
import { createTestDatabase } from '../helpers/db';
import { buildWorld } from '../helpers/world';

const at = (date: string, time: string) => zonedInstant(date, time, 'Asia/Manila');

let handle: DatabaseHandle;
let world: Awaited<ReturnType<typeof buildWorld>>;

beforeAll(async () => {
  handle = await createTestDatabase();
  world = await buildWorld(handle.db);
});

afterAll(async () => {
  await handle.close();
});

const day = async (personId: string, date: string) =>
  (await handle.db.select().from(journalDays).where(and(eq(journalDays.personId, personId), eq(journalDays.journalDate, date))))[0];

describe('journal ledger maintenance', () => {
  it('opens today on first use for everyone expected, idempotently', async () => {
    const first = await ensureJournalLedger(handle.db, at('2026-09-14', '08:00'));
    expect(first.opened).toEqual(['2026-09-14']);
    const rows = await handle.db.select().from(journalDays).where(eq(journalDays.journalDate, '2026-09-14'));
    expect(rows).toHaveLength(7); // the seven people placed in the test tree
    expect(rows.every((r) => r.submissionStatus === 'pending' && r.isExpected)).toBe(true);
    expect((await day(world.ids.john, '2026-09-14'))?.hierarchyPath).toEqual([world.ids.pastor, world.ids.michael, world.ids.mark]);

    const again = await ensureJournalLedger(handle.db, at('2026-09-14', '12:00'));
    expect(again).toEqual({ opened: [], resynced: [], closed: [] });
  });

  it('excuses everyone on a rest day and only closes a day after the late cutoff', async () => {
    await handle.db.insert(ministryCalendarDays).values({ day: '2026-09-15', kind: 'journal_rest_day', note: 'Retreat' });

    const morning = await ensureJournalLedger(handle.db, at('2026-09-15', '07:00'));
    expect(morning).toMatchObject({ opened: ['2026-09-15'], closed: [] });
    expect(await day(world.ids.grace, '2026-09-15')).toMatchObject({ submissionStatus: 'excused', excuseReason: 'rest_day', isExpected: false });

    const afterCutoff = await ensureJournalLedger(handle.db, at('2026-09-15', '09:01'));
    expect(afterCutoff.closed).toEqual(['2026-09-14']);
    expect(await day(world.ids.grace, '2026-09-14')).toMatchObject({ submissionStatus: 'missed' });
    expect((await day(world.ids.grace, '2026-09-14'))?.finalizedAt).not.toBeNull();
  });

  it('suggests a follow-up after three consecutive misses, skipping excused days', async () => {
    await handle.db.insert(journalPauses).values({ personId: world.ids.john, startsOn: '2026-09-16', reason: 'travel' });
    // Nobody journals from the 16th to the 18th. The 15th was a rest day.
    await ensureJournalLedger(handle.db, at('2026-09-16', '10:00'));
    await ensureJournalLedger(handle.db, at('2026-09-17', '10:00'));
    const result = await ensureJournalLedger(handle.db, at('2026-09-18', '10:00'));
    expect(result.closed).toEqual(['2026-09-17']);

    const [graceFollowUp] = await handle.db
      .select()
      .from(careFollowups)
      .where(and(eq(careFollowups.personId, world.ids.grace), eq(careFollowups.kind, 'journal_missed_streak')));
    expect(graceFollowUp).toMatchObject({ assignedToPersonId: world.ids.anna, summary: 'No journal for 3 days', status: 'open' });
    expect(await day(world.ids.grace, '2026-09-17')).toMatchObject({ careStatus: 'needs_follow_up' });

    // John is paused from the 16th: excused, no follow-up.
    expect(await day(world.ids.john, '2026-09-16')).toMatchObject({ submissionStatus: 'excused', excuseReason: 'pause' });
    const johnFollowUps = await handle.db.select().from(careFollowups).where(eq(careFollowups.personId, world.ids.john));
    expect(johnFollowUps).toHaveLength(0);

    // The streak grows on the same follow-up instead of creating a new one.
    await ensureJournalLedger(handle.db, at('2026-09-19', '10:00'));
    const graceAll = await handle.db.select().from(careFollowups).where(eq(careFollowups.personId, world.ids.grace));
    expect(graceAll).toHaveLength(1);
    expect(graceAll[0]!.summary).toBe('No journal for 4 days');
  });

  it('re-syncs open days after a move, keeping past days with the old leader', async () => {
    await movePerson(handle.db, world.admin, { personId: world.ids.grace, newLeaderId: world.ids.mark });
    const [run] = await handle.db.select().from(journalLedgerRuns).where(eq(journalLedgerRuns.journalDate, '2026-09-19'));
    expect(run!.needsResync).toBe(true);

    const result = await ensureJournalLedger(handle.db, at('2026-09-19', '11:00'));
    expect(result.resynced).toContain('2026-09-19');
    expect(await day(world.ids.grace, '2026-09-19')).toMatchObject({ leaderPersonId: world.ids.mark });
    expect(await day(world.ids.grace, '2026-09-17')).toMatchObject({ leaderPersonId: world.ids.anna });
  });

  it('removes today’s pending row when a person is archived', async () => {
    const { personId } = await (await import('@/server/modules/people/people.service')).createPerson(handle.db, world.admin, {
      firstName: 'Leaving',
      lastName: 'Soon',
      leaderId: world.ids.anna,
    });
    await ensureJournalLedger(handle.db, at('2026-09-19', '12:00'));
    expect(await day(personId, '2026-09-19')).toMatchObject({ submissionStatus: 'pending' });

    await archivePerson(handle.db, world.admin, { personId, reason: 'moved' });
    await ensureJournalLedger(handle.db, at('2026-09-19', '12:30'));
    expect(await day(personId, '2026-09-19')).toBeUndefined();
  });

  it('catches up on days nobody used the system and closes them', async () => {
    const result = await ensureJournalLedger(handle.db, at('2026-09-23', '10:00'));
    expect(result.opened).toEqual(['2026-09-20', '2026-09-21', '2026-09-22', '2026-09-23']);
    expect(result.closed).toEqual(['2026-09-19', '2026-09-20', '2026-09-21', '2026-09-22']);
  });
});
