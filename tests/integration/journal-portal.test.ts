import { randomUUID } from 'node:crypto';
import { and, eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { RequestContext } from '@/server/context/request-context';
import type { DatabaseHandle } from '@/server/db/client';
import { auditLogs, hierarchyNodes, journalDays, people } from '@/server/db/schema';
import { listFollowUps, updateFollowUp } from '@/server/modules/care/care.service';
import { getPublishedForm, JOURNAL_FORM_KEY } from '@/server/modules/forms/forms.service';
import { setAcceptsMembers } from '@/server/modules/hierarchy/hierarchy.service';
import {
  addPause,
  endPause,
  listPauses,
  removeCalendarDay,
  setCalendarDay,
  setDayExcused,
} from '@/server/modules/journal/journal-calendar.service';
import { zonedInstant } from '@/server/modules/journal/journal-dates';
import {
  getJournalEntry,
  getJournalOverview,
  getPersonJournalSummary,
  listAwaitingReview,
  reviewJournalEntry,
} from '@/server/modules/journal/journal-portal.service';
import { submitJournal, submitJournalByProxy } from '@/server/modules/journal/journal-submit.service';
import { decideRegistration, listUnconfirmedRegistrations } from '@/server/modules/people/registrations.service';
import { ensureLeaderEntryCode } from '@/server/modules/public/entry-codes.service';
import {
  installPersonalLink,
  issuePersonalLink,
  registerParticipant,
  resolveParticipantKey,
} from '@/server/modules/public/participants.service';
import { getSetting, updateSetting } from '@/server/modules/settings/settings.service';
import { createTestDatabase } from '../helpers/db';
import { globalGrant, userContext } from '../helpers/fixtures';
import { buildWorld } from '../helpers/world';

const TODAY = '2026-09-15';
const at = (time: string, date = TODAY) => zonedInstant(date, time, 'Asia/Manila');
const req = (now: Date, ip = '203.0.113.20') => ({ now, ip, userAgent: 'Mozilla/5.0 (Linux; Android 14) Chrome/120 Mobile' });
const atTime = (ctx: RequestContext, now: Date): RequestContext => ({ ...ctx, now });

let handle: DatabaseHandle;
let db: DatabaseHandle['db'];
let world: Awaited<ReturnType<typeof buildWorld>>;
let versionId: string;
let johnEntryId: string;
let restrictedKey: string;
let confidentialKey: string;
let pastoral: RequestContext;

const mark = () => atTime(world.markCtx, at('10:00'));
const anna = () => atTime(world.annaCtx, at('10:00'));
const office = () => atTime(world.admin, at('10:00'));

async function dayOf(personId: string, date = TODAY) {
  const [row] = await db
    .select()
    .from(journalDays)
    .where(and(eq(journalDays.personId, personId), eq(journalDays.journalDate, date)));
  return row;
}

beforeAll(async () => {
  handle = await createTestDatabase();
  db = handle.db;
  world = await buildWorld(db);
  // These tests are about the journal itself, not the photo (tests/integration/journal-proof.test.ts),
  // so the ministry setting is left inviting a photo rather than insisting on one.
  await updateSetting(db, world.admin, 'journal.policy', { ...(await getSetting(db, 'journal.policy')), proofImage: 'optional' });

  const form = (await getPublishedForm(db, JOURNAL_FORM_KEY))!;
  versionId = form.versionId;
  restrictedKey = form.fields.find((f) => f.sensitivity === 'restricted')!.key;
  confidentialKey = form.fields.find((f) => f.sensitivity === 'confidential')!.key;

  const adminUserId = world.admin.actor.kind === 'user' ? world.admin.actor.userId : '';
  pastoral = userContext(
    { id: adminUserId },
    [
      globalGrant('journal.status.view'),
      globalGrant('journal.content.view'),
      globalGrant('journal.content.restricted.view'),
      globalGrant('journal.content.confidential.view'),
      globalGrant('care.view'),
      globalGrant('care.manage'),
      globalGrant('care.pastoral.view'),
    ],
    at('10:00'),
  );

  // John journals at 07:00 through a personal link from his leader.
  const link = await issuePersonalLink(db, world.admin, { personId: world.ids.john });
  const { key } = await installPersonalLink(db, req(at('06:55')), { token: link.url.split('/k/')[1]! });
  const john = (await resolveParticipantKey(db, key.secret, at('06:55')))!;
  await submitJournal(db, john, req(at('07:00')), {
    idempotencyKey: randomUUID(),
    formVersionId: versionId,
    journalDate: TODAY,
    answers: {
      reflection: 'God is faithful.',
      prayed: true,
      [restrictedKey]: 'Please pray for my exams.',
      [confidentialKey]: 'Something only my pastor should know.',
    },
  });
  johnEntryId = (await dayOf(world.ids.john))!.entryId!;

});

afterAll(async () => {
  await handle.close();
});

describe('portal journal', () => {
  it('shows a leader their own group for today, and the whole ministry to the office', async () => {
    const mine = await getJournalOverview(db, mark(), {});
    expect(mine.view).toBe('direct');
    expect(mine.leader).toMatchObject({ id: world.ids.mark, isSelf: true });
    expect(mine.people.map((p) => p.personId)).toEqual([world.ids.john]);
    expect(mine.people[0]).toMatchObject({ status: 'submitted', reviewStatus: 'awaiting' });
    expect(mine.people[0]!.week.at(-1)).toEqual({ date: TODAY, status: 'submitted' });

    const everyone = await getJournalOverview(db, office(), {});
    expect(everyone.view).toBe('all');
    expect(everyone.summary).toMatchObject({ expected: 7, received: 1, notYet: 6 });
    expect(everyone.people[0]!.status).toBe('pending');

    const fromPastor = await getJournalOverview(db, office(), { leaderId: world.ids.pastor });
    expect(fromPastor.groups.map((g) => [g.leaderName, g.expected, g.received])).toEqual([
      ['Michael Reyes', 2, 1],
      ['Samuel Torres', 2, 0],
    ]);

    await expect(getJournalOverview(db, mark(), { leaderId: world.ids.anna })).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });

  it('lets the direct leader read standard and restricted answers, keeping confidential ones for pastors', async () => {
    const leaderView = await getJournalEntry(db, mark(), { personId: world.ids.john, date: TODAY });
    expect(leaderView.entry?.answers.map((a) => a.key).sort()).toEqual(['prayed', 'reflection', restrictedKey].sort());
    expect(leaderView.entry).toMatchObject({ contentAllowed: true, hiddenCount: 1 });
    expect(leaderView.canReview).toBe(true);

    const pastorView = await getJournalEntry(db, pastoral, { personId: world.ids.john, date: TODAY });
    expect(pastorView.entry?.answers).toHaveLength(4);
    expect(pastorView.entry?.hiddenCount).toBe(0);

    const officeView = await getJournalEntry(db, office(), { personId: world.ids.john, date: TODAY });
    expect(officeView.status).toBe('submitted');
    expect(officeView.entry).toMatchObject({ contentAllowed: false, answers: [], hiddenCount: 4 });

    await expect(getJournalEntry(db, anna(), { personId: world.ids.john, date: TODAY })).rejects.toMatchObject({ code: 'NOT_FOUND' });

    const accessLog = await db.select().from(auditLogs).where(eq(auditLogs.action, 'journal.content_viewed'));
    expect(accessLog).toHaveLength(2); // Mark and the pastor; the office saw no answers
  });

  it('reviews an entry and raises a pastoral follow-up that only pastors see', async () => {
    const queue = await listAwaitingReview(db, mark(), {});
    expect(queue.items.map((i) => i.personId)).toEqual([world.ids.john]);

    const { followUpId } = await reviewJournalEntry(db, mark(), { entryId: johnEntryId, comment: 'Praying with you.', followUp: 'pastoral' });
    expect(followUpId).not.toBeNull();
    await reviewJournalEntry(db, mark(), { entryId: johnEntryId, comment: 'Praying with you, brother.', followUp: 'pastoral' });
    expect((await listAwaitingReview(db, mark(), {})).total).toBe(0);

    const view = await getJournalEntry(db, mark(), { personId: world.ids.john, date: TODAY });
    expect(view.entry?.reviews).toEqual([expect.objectContaining({ comment: 'Praying with you, brother.', flaggedFollowUp: true, mine: true })]);
    expect(view.careStatus).toBe('needs_follow_up');

    expect((await listFollowUps(db, mark(), {})).items).toHaveLength(0);
    const pool = await listFollowUps(db, pastoral, { assigned: 'pastoral_pool' });
    expect(pool.items).toEqual([
      expect.objectContaining({ id: followUpId, kind: 'journal_flagged', visibility: 'pastoral', journalDate: TODAY, assignedTo: null }),
    ]);

    await updateFollowUp(db, pastoral, { followUpId, status: 'resolved', note: 'Called John — he is doing better.' });
    expect((await dayOf(world.ids.john))!.careStatus).toBe('resolved');

    await expect(reviewJournalEntry(db, anna(), { entryId: johnEntryId })).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });

  it('excuses single days and pauses without touching received journals', async () => {
    await expect(setDayExcused(db, office(), { personId: world.ids.john, journalDate: TODAY, excused: true })).rejects.toMatchObject({
      code: 'INVALID_STATE',
    });
    await expect(setDayExcused(db, mark(), { personId: world.ids.grace, journalDate: TODAY, excused: true })).rejects.toMatchObject({
      code: 'NOT_FOUND',
    });

    await setDayExcused(db, office(), { personId: world.ids.grace, journalDate: TODAY, excused: true, note: 'Out of town' });
    expect(await dayOf(world.ids.grace)).toMatchObject({ submissionStatus: 'excused', excuseReason: 'admin_excused' });
    await setDayExcused(db, office(), { personId: world.ids.grace, journalDate: TODAY, excused: false });
    expect(await dayOf(world.ids.grace)).toMatchObject({ submissionStatus: 'pending', excuseReason: null });

    const { pauseId } = await addPause(db, office(), { personId: world.ids.anna, startsOn: TODAY, reason: 'sickness', note: 'Recovering from flu' });
    await expect(addPause(db, office(), { personId: world.ids.anna, startsOn: '2026-09-20', reason: 'travel' })).rejects.toMatchObject({
      code: 'CONFLICT',
    });
    await getJournalOverview(db, office(), {}); // ledger maintenance runs on the next read
    expect(await dayOf(world.ids.anna)).toMatchObject({ submissionStatus: 'excused', excuseReason: 'pause' });
    expect(await listPauses(db, office(), world.ids.anna)).toEqual([expect.objectContaining({ id: pauseId, note: 'Recovering from flu' })]);

    await endPause(db, office(), { pauseId });
    await getJournalOverview(db, office(), {});
    expect(await dayOf(world.ids.anna)).toMatchObject({ submissionStatus: 'pending', excuseReason: null });
  });

  it('lets a leader record a journal shared by phone, once per day', async () => {
    const input = {
      personId: world.ids.john,
      idempotencyKey: randomUUID(),
      formVersionId: versionId,
      journalDate: '2026-09-14',
      answers: { reflection: 'Shared by phone.', prayed: true },
    };
    const first = await submitJournalByProxy(db, mark(), input);
    expect(await submitJournalByProxy(db, mark(), input)).toEqual(first);
    expect(await dayOf(world.ids.john, '2026-09-14')).toMatchObject({ submissionStatus: 'late', reviewStatus: 'none' });

    await expect(submitJournalByProxy(db, mark(), { ...input, idempotencyKey: randomUUID() })).rejects.toMatchObject({ code: 'CONFLICT' });
    await expect(submitJournalByProxy(db, mark(), { ...input, idempotencyKey: randomUUID(), personId: world.ids.grace })).rejects.toMatchObject({
      code: 'NOT_FOUND',
    });
    await expect(submitJournalByProxy(db, mark(), { ...input, idempotencyKey: randomUUID(), journalDate: '2026-09-07' })).rejects.toMatchObject({
      code: 'VALIDATION_ERROR',
    });

    const summary = await getPersonJournalSummary(db, mark(), world.ids.john);
    expect(summary.days.slice(-2).map((d) => d.status)).toEqual(['late', 'submitted']);
    expect(summary).toMatchObject({ canProxy: true, canExcuse: true, consistency: { received: 2, of: 2 } });
  });

  it('confirms or declines people who registered from the journal page', async () => {
    await setAcceptsMembers(db, world.admin, { personId: world.ids.mark, acceptsMembers: true });
    const markCode = (await ensureLeaderEntryCode(db, world.ids.mark)).code;
    const register = (firstName: string, phone: string) =>
      registerParticipant(db, req(at('08:00'), '198.51.100.30'), { firstName, lastName: 'Garcia', phone, leaderRef: markCode, consent: true });
    const carlo = await register('Carlo', '0917 222 0001');
    const visitor = await register('Visitor', '0917 222 0002');

    const pending = await listUnconfirmedRegistrations(db, mark(), {});
    expect(pending.items.map((i) => i.name)).toEqual(['Carlo Garcia', 'Visitor Garcia']);
    expect(pending.items[0]).toMatchObject({ leaderName: 'Mark Santos', phone: expect.any(String) });

    await decideRegistration(db, mark(), { personId: carlo.personId, decision: 'confirm' });
    const overview = await getJournalOverview(db, mark(), {});
    expect(overview.people.find((p) => p.personId === carlo.personId)).toMatchObject({ status: 'pending', isExpected: true });

    await decideRegistration(db, mark(), { personId: visitor.personId, decision: 'decline', note: 'Not someone we know' });
    const [declined] = await db.select().from(people).where(eq(people.id, visitor.personId));
    expect(declined).toMatchObject({ registrationStatus: 'rejected', archivedReason: 'other' });
    expect(await db.select().from(hierarchyNodes).where(eq(hierarchyNodes.personId, visitor.personId))).toHaveLength(0);
    expect(await resolveParticipantKey(db, visitor.key.secret, at('10:00'))).toBeNull();

    await expect(decideRegistration(db, mark(), { personId: carlo.personId, decision: 'decline' })).rejects.toMatchObject({ code: 'INVALID_STATE' });
    await expect(listUnconfirmedRegistrations(db, anna(), {})).resolves.toMatchObject({ total: 0 });
  });

  it('marks a rest day for everyone still expected; only people with journal settings can', async () => {
    await expect(setCalendarDay(db, mark(), { day: TODAY })).rejects.toMatchObject({ code: 'FORBIDDEN' });
    await expect(setCalendarDay(db, office(), { day: '2026-09-14' })).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });

    await setCalendarDay(db, office(), { day: TODAY, note: 'Church anniversary' });
    await getJournalOverview(db, office(), {});
    expect(await dayOf(world.ids.grace)).toMatchObject({ submissionStatus: 'excused', excuseReason: 'rest_day' });
    expect(await dayOf(world.ids.john)).toMatchObject({ submissionStatus: 'submitted' });

    await removeCalendarDay(db, office(), { day: TODAY });
    await getJournalOverview(db, office(), {});
    expect(await dayOf(world.ids.grace)).toMatchObject({ submissionStatus: 'pending', excuseReason: null });
  });
});
