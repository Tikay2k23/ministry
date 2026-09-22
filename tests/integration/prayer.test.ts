import { and, eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { RequestContext } from '@/server/context/request-context';
import type { DatabaseHandle } from '@/server/db/client';
import { auditLogs, careFollowups, forms, notifications, prayerAssignmentEvents, prayerAssignments, prayerChains, prayerSlots } from '@/server/db/schema';
import { zonedInstant } from '@/server/modules/journal/journal-dates';
import { countUnreadNotifications, listInbox, markNotificationsRead } from '@/server/modules/notifications/notifications.service';
import {
  assignToSlot,
  cancelAssignment,
  getAssignmentReport,
  getChainBoard,
  resolveFollowUp,
  searchAssignablePeople,
  shareAssignmentLink,
  substituteAssignment,
  suggestSubstitutes,
} from '@/server/modules/prayer/assignments.service';
import { createChain, setChainStatus, updateChain } from '@/server/modules/prayer/chains.service';
import { coordinatorUserIds } from '@/server/modules/prayer/coordinators.service';
import {
  claimSlot,
  getChainPage,
  getSlotByActionLink,
  respondFromChainPage,
  respondWithActionLink,
  submitReportFromChainPage,
  submitReportWithActionLink,
} from '@/server/modules/prayer/participation.service';
import { flagOverdueAssignments, sendSlotReminders } from '@/server/modules/prayer/prayer-jobs.service';
import { resolveEntryCode } from '@/server/modules/public/entry-codes.service';
import { issueParticipantKey, resolveParticipantKey } from '@/server/modules/public/participants.service';
import { exportPrayerReport, getPrayerCompletionReport } from '@/server/modules/reports/prayer-reports.service';
import type { PermissionKey } from '@/server/policy/catalog';
import type { Grant } from '@/server/policy/grants';
import { createTestDatabase } from '../helpers/db';
import { globalGrant, userContext } from '../helpers/fixtures';
import { buildWorld } from '../helpers/world';

const TZ = 'Asia/Manila';
const at = (date: string, time: string) => zonedInstant(date, time, TZ);
const req = (now: Date) => ({ now, ip: '203.0.113.30', userAgent: 'Mozilla/5.0 (Linux; Android 14) Chrome/120 Mobile' });
const plain = (text: string | null | undefined) => (text ?? '').replace(/\s/g, ' ').toLowerCase();
const tokenOf = (url: string) => url.split('/a/')[1]!;

let handle: DatabaseHandle;
let db: DatabaseHandle['db'];
let world: Awaited<ReturnType<typeof buildWorld>>;
let adminUserId: string;
let chainId: string;
let chainCode: string;
let vigilChainId: string;
let johnAssignment: string;
let johnToken: string;
let samuelAssignment: string;

const COORDINATOR: PermissionKey[] = ['prayer.view', 'prayer.manage', 'prayer.assign', 'prayer.resolve', 'prayer.reports.view', 'people.view', 'people.contact.view'];
/** A coordinator for every chain. */
const office = (now: Date): RequestContext => userContext({ id: adminUserId }, COORDINATOR.map(globalGrant), now);
/** The pastoral team: reports, confidential requests and anonymous authors. */
const pastor = (now: Date): RequestContext =>
  userContext({ id: adminUserId }, (['prayer.view', 'prayer.reports.view', 'prayer.requests.confidential.view'] as PermissionKey[]).map(globalGrant), now);
/** The Prayer Chain Coordinator role, scoped to one chain. */
const coordinatorOf = (forChainId: string, now: Date): RequestContext =>
  userContext(
    { id: adminUserId },
    COORDINATOR.map((permission): Grant => ({ permission, scope: { type: 'prayer_chain', chainId: forChainId }, roleKey: 'prayer_coordinator' })),
    now,
  );

/** Everything updateChain needs, so a test can change one switch without rewriting the chain. */
const chainSettings = {
  get chainId() {
    return chainId;
  },
  name: 'Night and Day',
  chainType: 'continuous' as const,
  timezone: TZ,
  startsOn: '2026-09-20',
  graceMinutes: 15,
  checkinOpensMinutes: 15,
  requireCheckin: false,
  showNamesPublicly: false,
  allowSelfSignup: false,
  collectReports: true,
};

async function slotAt(date: string, time: string, forChainId = chainId) {
  const [slot] = await db
    .select()
    .from(prayerSlots)
    .where(and(eq(prayerSlots.prayerChainId, forChainId), eq(prayerSlots.startsAt, at(date, time))));
  if (!slot) throw new Error(`No slot at ${date} ${time}`);
  return slot;
}

async function assignment(id: string) {
  const [row] = await db.select().from(prayerAssignments).where(eq(prayerAssignments.id, id));
  return row!;
}

const failure = (promise: Promise<unknown>) =>
  promise.then(
    () => null,
    (error: { code?: string; message?: string; details?: { meta?: { reason?: string } } }) => ({
      code: error.code,
      message: error.message,
      reason: error.details?.meta?.reason,
    }),
  );

beforeAll(async () => {
  handle = await createTestDatabase();
  db = handle.db;
  world = await buildWorld(db);
  adminUserId = world.admin.actor.kind === 'user' ? world.admin.actor.userId : '';
});

afterAll(async () => {
  await handle.close();
});

describe('prayer chain (M3)', () => {
  it('creates a chain with the default report form and its own public code', async () => {
    const created = await createChain(db, office(at('2026-09-19', '10:00')), {
      name: 'Night and Day',
      chainType: 'continuous',
      timezone: TZ,
      startsOn: '2026-09-20',
      schedule: { rrule: 'FREQ=DAILY', firstSlotTime: '00:00', slotMinutes: 60, slotsPerOccurrence: 24, capacity: 1, effectiveFrom: '2026-09-20', generateDaysAhead: 3 },
    });
    chainId = created.chainId;
    chainCode = created.code;

    const [chain] = await db.select().from(prayerChains).where(eq(prayerChains.id, chainId));
    const [reportForm] = await db.select().from(forms).where(eq(forms.key, 'prayer_report'));
    expect(chain).toMatchObject({ status: 'draft', reportFormId: reportForm!.id });
    expect(await resolveEntryCode(db, chainCode, ['prayer_chain'])).toMatchObject({ kind: 'prayer_chain', prayerChainId: chainId });
    expect(await resolveEntryCode(db, chainCode)).toBeNull(); // a chain code never opens the journal
  });

  it('generates slots in the chain’s time zone when it starts', async () => {
    const result = await setChainStatus(db, office(at('2026-09-19', '10:00')), { chainId, status: 'active' });
    expect(result.generated?.slotsCreated).toBe(72); // 3 days × 24 hourly slots
    const midnight = await slotAt('2026-09-20', '00:00');
    expect(midnight).toMatchObject({ chainDate: '2026-09-20', startsAt: new Date('2026-09-19T16:00:00.000Z') });
  });

  it('assigns people, refusing a full slot and a time the person already prays elsewhere', async () => {
    const now = at('2026-09-19', '10:00');
    const slot = await slotAt('2026-09-20', '02:00');
    johnAssignment = (await assignToSlot(db, office(now), { slotId: slot.id, personId: world.ids.john })).assignmentId;
    expect(await failure(assignToSlot(db, office(now), { slotId: slot.id, personId: world.ids.grace }))).toMatchObject({ code: 'CONFLICT', reason: 'CAPACITY_FULL' });

    const vigil = await createChain(db, office(now), {
      name: 'Friday Vigil',
      chainType: 'event',
      timezone: TZ,
      startsOn: '2026-09-20',
      endsOn: '2026-09-20',
      schedule: { rrule: 'FREQ=DAILY', firstSlotTime: '02:30', slotMinutes: 60, slotsPerOccurrence: 1, capacity: 3, effectiveFrom: '2026-09-20', generateDaysAhead: 3 },
    });
    vigilChainId = vigil.chainId;
    await setChainStatus(db, office(now), { chainId: vigilChainId, status: 'active' });
    const vigilSlot = await slotAt('2026-09-20', '02:30', vigilChainId);
    expect(await failure(assignToSlot(db, office(now), { slotId: vigilSlot.id, personId: world.ids.john }))).toMatchObject({ code: 'CONFLICT', reason: 'OVERLAP' });

    const [notice] = await db.select().from(notifications).where(eq(notifications.dedupeKey, `prayer_assigned:${johnAssignment}`));
    expect(notice).toMatchObject({ templateKey: 'prayer.assigned', recipientPersonId: world.ids.john, status: 'pending' });
  });

  it('shows the day board with coverage and gaps', async () => {
    const board = await getChainBoard(db, office(at('2026-09-19', '10:00')), { chainId, date: '2026-09-20' });
    expect(board.summary).toEqual({ slots: 24, covered: 1, completed: 0, gaps: 23 });
    const twoAm = board.slots.find((s) => s.startsAt.getTime() === at('2026-09-20', '02:00').getTime());
    expect(twoAm?.assignments).toEqual([expect.objectContaining({ name: 'John Cruz', status: 'scheduled' })]);
  });

  it('keeps the coordinator of one chain out of another chain (docs/06 T14)', async () => {
    const now = at('2026-09-19', '10:00');
    const vigilCoordinator = coordinatorOf(vigilChainId, now);
    await expect(getChainBoard(db, vigilCoordinator, { chainId })).rejects.toMatchObject({ code: 'NOT_FOUND' });
    const slot = await slotAt('2026-09-20', '04:00');
    await expect(assignToSlot(db, vigilCoordinator, { slotId: slot.id, personId: world.ids.grace })).rejects.toMatchObject({ code: 'NOT_FOUND' });
    expect((await getChainBoard(db, vigilCoordinator, { chainId: vigilChainId, date: '2026-09-20' })).slots).toHaveLength(1);
  });

  it('lets the person confirm, check in and finish through their link, each at the right time', async () => {
    johnToken = tokenOf((await shareAssignmentLink(db, office(at('2026-09-19', '10:00')), { assignmentId: johnAssignment })).url);

    const page = await getSlotByActionLink(db, johnToken, at('2026-09-19', '10:00'));
    expect(page).toMatchObject({ status: 'ok', firstName: 'John', slot: { state: 'upcoming', primaryAction: 'confirm' } });
    expect(plain(page.status === 'ok' ? page.slot.hint : null)).toBe('you can confirm until 2:00 am.');

    const early = await failure(respondWithActionLink(db, req(at('2026-09-19', '10:00')), { token: johnToken, action: 'check_in' }));
    expect(early).toMatchObject({ code: 'VALIDATION_ERROR', reason: 'WINDOW_NOT_OPEN' });
    expect(plain(early?.message)).toBe('check-in opens at 1:45 am.');

    expect((await respondWithActionLink(db, req(at('2026-09-19', '10:01')), { token: johnToken, action: 'confirm' })).slot.state).toBe('confirmed');
    await respondWithActionLink(db, req(at('2026-09-19', '10:02')), { token: johnToken, action: 'confirm' }); // a second tap changes nothing
    const confirmations = await db
      .select()
      .from(prayerAssignmentEvents)
      .where(and(eq(prayerAssignmentEvents.assignmentId, johnAssignment), eq(prayerAssignmentEvents.eventType, 'confirmed')));
    expect(confirmations).toHaveLength(1);

    expect((await respondWithActionLink(db, req(at('2026-09-20', '01:50')), { token: johnToken, action: 'check_in' })).slot.state).toBe('praying');
    const finished = await respondWithActionLink(db, req(at('2026-09-20', '03:05')), { token: johnToken, action: 'complete' });
    expect(finished.slot).toMatchObject({ state: 'completed', completedLate: false, canReport: true });
    expect(finished.report?.fields.map((f) => f.key)).toEqual(['report', 'testimony', 'prayer_request']);
  });

  it('keeps confidential prayer requests for the pastoral team and logs every report read', async () => {
    const now = at('2026-09-20', '03:10');
    await submitReportWithActionLink(db, req(now), { token: johnToken, answers: { testimony: 'God met me in the quiet.', prayer_request: 'Please pray for my mother.' } });
    expect(await failure(submitReportWithActionLink(db, req(now), { token: johnToken, answers: { testimony: 'Again' } }))).toMatchObject({
      code: 'CONFLICT',
      reason: 'ALREADY_SUBMITTED',
    });

    const coordinatorView = await getAssignmentReport(db, office(now), { assignmentId: johnAssignment });
    expect(coordinatorView.answers.map((a) => a.label)).toEqual(['Is there a testimony you would like to share?']);
    expect(coordinatorView.privateAnswers).toBe(1);
    const pastoralView = await getAssignmentReport(db, pastor(now), { assignmentId: johnAssignment });
    expect(JSON.stringify(pastoralView.answers)).toContain('Please pray for my mother.');

    const reads = await db
      .select()
      .from(auditLogs)
      .where(and(eq(auditLogs.action, 'prayer.report_viewed'), eq(auditLogs.entityId, johnAssignment)));
    expect(reads).toHaveLength(2);
  });

  it('flags a slot nobody marked finished for follow-up, and only a coordinator resolves it', async () => {
    const assignedAt = at('2026-09-19', '10:00');
    const graceAssignment = (await assignToSlot(db, office(assignedAt), { slotId: (await slotAt('2026-09-20', '05:00')).id, personId: world.ids.grace })).assignmentId;
    const annaAssignment = (await assignToSlot(db, office(assignedAt), { slotId: (await slotAt('2026-09-20', '06:00')).id, personId: world.ids.anna })).assignmentId;

    expect((await flagOverdueAssignments(db, at('2026-09-20', '07:20'))).flagged).toBe(2);
    expect((await flagOverdueAssignments(db, at('2026-09-20', '07:25'))).flagged).toBe(0);
    expect((await assignment(graceAssignment)).status).toBe('needs_follow_up');

    const [followUp] = await db.select().from(careFollowups).where(eq(careFollowups.dedupeKey, `prayer_follow_up:${graceAssignment}`));
    expect(followUp).toMatchObject({ kind: 'prayer_unconfirmed', status: 'open', personId: world.ids.grace });
    const coordinators = await coordinatorUserIds(db, { id: chainId, ministryId: null });
    expect(coordinators.length).toBeGreaterThan(0);
    expect(await db.select().from(notifications).where(eq(notifications.templateKey, 'prayer.follow_up_needed'))).toHaveLength(2 * coordinators.length);

    await expect(resolveFollowUp(db, office(at('2026-09-20', '09:00')), { assignmentId: johnAssignment, outcome: 'missed' })).rejects.toMatchObject({ code: 'INVALID_STATE' });
    await resolveFollowUp(db, office(at('2026-09-20', '09:00')), { assignmentId: graceAssignment, outcome: 'excused', note: 'In hospital' });
    expect(await assignment(graceAssignment)).toMatchObject({ status: 'excused', resolvedBy: adminUserId });
    const [closed] = await db.select().from(careFollowups).where(eq(careFollowups.dedupeKey, `prayer_follow_up:${graceAssignment}`));
    expect(closed?.status).toBe('resolved');

    // Anna prayed but forgot to tap. Finishing late closes her follow-up (docs/05 W13 step 5).
    const annaToken = tokenOf((await shareAssignmentLink(db, office(at('2026-09-20', '09:00')), { assignmentId: annaAssignment })).url);
    const late = await respondWithActionLink(db, req(at('2026-09-20', '09:05')), { token: annaToken, action: 'complete' });
    expect(late.slot).toMatchObject({ state: 'completed', completedLate: true });
    const [annaFollowUp] = await db.select().from(careFollowups).where(eq(careFollowups.dedupeKey, `prayer_follow_up:${annaAssignment}`));
    expect(annaFollowUp?.status).toBe('resolved');
    await resolveFollowUp(db, office(at('2026-09-20', '09:10')), { assignmentId: annaAssignment, outcome: 'completed_verified' });
    expect(await assignment(annaAssignment)).toMatchObject({ status: 'completed', verifiedByCoordinator: true });
  });

  it('shows a coordinator their follow-up notices unread first, and marks them read (docs/04 A24)', async () => {
    const [recipient] = await coordinatorUserIds(db, { id: chainId, ministryId: null });
    const me = userContext({ id: recipient! }, [], at('2026-09-20', '10:00'));

    const before = await listInbox(db, me, {});
    expect(before.unread).toBe(2);
    expect(before.items[0]).toMatchObject({ title: 'A prayer slot needs follow-up', readAt: null, actionLabel: 'Open the chain board' });
    expect(before.items[0]!.portalPath).toMatch(new RegExp(`^/app/prayer/${chainId}\\?date=2026-09-20$`));

    const readFirst = before.items[0]!.id;
    await markNotificationsRead(db, me, { ids: [readFirst] });
    const after = await listInbox(db, me, {});
    expect(after.unread).toBe(1);
    expect(after.items.map((item) => item.id).at(-1)).toBe(readFirst); // read ones sink below the unread
    expect(await listInbox(db, me, { unreadOnly: true })).toMatchObject({ total: 1, unread: 1 });

    await markNotificationsRead(db, me, { all: true });
    expect(await countUnreadNotifications(db, me)).toBe(0);
  });

  it('hands a slot to a substitute when someone can’t make it, and their old link says so kindly', async () => {
    const now = at('2026-09-20', '09:00');
    const markAssignment = (await assignToSlot(db, office(now), { slotId: (await slotAt('2026-09-21', '03:00')).id, personId: world.ids.mark })).assignmentId;
    const markToken = tokenOf((await shareAssignmentLink(db, office(now), { assignmentId: markAssignment })).url);

    const said = await respondWithActionLink(db, req(at('2026-09-20', '09:30')), { token: markToken, action: 'cannot_make_it', reason: 'travel', note: 'Out of town' });
    expect(said.slot).toMatchObject({ cannotMakeIt: true, canSayCannotMakeIt: false });
    const board = await getChainBoard(db, office(at('2026-09-20', '09:31')), { chainId, date: '2026-09-21' });
    expect(board.needsSubstitute).toEqual([expect.objectContaining({ assignmentId: markAssignment, name: 'Mark Santos' })]);
    const [notice] = await db.select().from(notifications).where(eq(notifications.templateKey, 'prayer.cannot_make_it'));
    expect(notice?.payload).toMatchObject({ personName: 'Mark S.', chainName: 'Night and Day' });

    const suggestions = (await suggestSubstitutes(db, office(at('2026-09-20', '09:31')), { assignmentId: markAssignment })).map((s) => s.name);
    expect(suggestions).toEqual(expect.arrayContaining(['John Cruz', 'Anna Lim', 'Grace Mendoza']));
    expect(suggestions).not.toContain('Mark Santos');

    const swap = await substituteAssignment(db, office(at('2026-09-20', '09:32')), { assignmentId: markAssignment, substitutePersonId: world.ids.john, reason: 'Mark is travelling' });
    expect(swap.originalReplaced).toBe(true);
    expect((await assignment(markAssignment)).status).toBe('replaced');
    expect(await assignment(swap.substituteAssignmentId)).toMatchObject({ status: 'scheduled', source: 'substitute', substituteForId: markAssignment, personId: world.ids.john });

    expect(await getSlotByActionLink(db, markToken, at('2026-09-20', '09:40'))).toEqual({ status: 'reassigned', chainName: 'Night and Day' });
    expect(await failure(respondWithActionLink(db, req(at('2026-09-20', '09:40')), { token: markToken, action: 'confirm' }))).toMatchObject({
      code: 'INVALID_STATE',
      reason: 'REASSIGNED',
    });
  });

  it('takes someone off an upcoming slot and stops their link', async () => {
    const now = at('2026-09-20', '09:45');
    const removed = (await assignToSlot(db, office(now), { slotId: (await slotAt('2026-09-21', '08:00')).id, personId: world.ids.michael })).assignmentId;
    const token = tokenOf((await shareAssignmentLink(db, office(now), { assignmentId: removed })).url);
    await cancelAssignment(db, office(now), { assignmentId: removed, reason: 'Added by mistake' });
    expect((await assignment(removed)).status).toBe('cancelled');
    expect(await getSlotByActionLink(db, token, now)).toMatchObject({ status: 'reassigned' });
  });

  it('reminds a day before and 30 minutes before, once each', async () => {
    samuelAssignment = (await assignToSlot(db, office(at('2026-09-20', '09:00')), { slotId: (await slotAt('2026-09-22', '10:00')).id, personId: world.ids.samuel })).assignmentId;

    expect(await sendSlotReminders(db, at('2026-09-21', '10:30'))).toEqual({ dayBefore: 1, soon: 0 });
    expect(await sendSlotReminders(db, at('2026-09-21', '10:35'))).toEqual({ dayBefore: 0, soon: 0 });
    expect(await sendSlotReminders(db, at('2026-09-22', '09:35'))).toEqual({ dayBefore: 0, soon: 1 });

    const sent = await db.select({ key: notifications.dedupeKey }).from(notifications).where(eq(notifications.recipientPersonId, world.ids.samuel));
    expect(sent.map((n) => n.key).sort()).toEqual(
      [`prayer_assigned:${samuelAssignment}`, `prayer_slot_reminder:${samuelAssignment}:24h`, `prayer_slot_reminder:${samuelAssignment}:30m`].sort(),
    );
  });

  it('shows the chain page to anyone, and a remembered person their own slots and actions', async () => {
    const now = at('2026-09-21', '02:10');
    const publicPage = await getChainPage(db, { code: chainCode }, null, now);
    expect(publicPage).toMatchObject({ status: 'ok', chain: { name: 'Night and Day' }, coverageToday: { total: 24 }, participant: null });

    const key = await issueParticipantKey(db, { personId: world.ids.john, createdVia: 'phone_match', persistent: true, now, userAgent: null });
    const identity = (await resolveParticipantKey(db, key.secret, now))!;
    const page = await getChainPage(db, { code: chainCode, scan: true }, identity, now);
    if (page.status !== 'ok' || !page.participant) throw new Error('Expected John’s chain page');
    expect(page.participant.firstName).toBe('John');
    const [next] = page.participant.slots;
    expect(next).toMatchObject({ state: 'upcoming', primaryAction: 'confirm' });

    // Someone else's slot is invisible from John's phone.
    expect(await failure(respondFromChainPage(db, identity, req(now), { assignmentId: samuelAssignment, action: 'confirm' }))).toMatchObject({ code: 'NOT_FOUND' });

    expect((await respondFromChainPage(db, identity, req(at('2026-09-21', '02:50')), { assignmentId: next!.id, action: 'check_in' })).slot.state).toBe('praying');
    const during = await getChainPage(db, { code: chainCode }, null, at('2026-09-21', '03:10'));
    expect(during.status === 'ok' ? during.now : null).toMatchObject({ prayingCount: 1, prayingFirstNames: null }); // names stay private unless the chain allows them

    await respondFromChainPage(db, identity, req(at('2026-09-21', '04:00')), { assignmentId: next!.id, action: 'complete' });
    await submitReportFromChainPage(db, identity, req(at('2026-09-21', '04:05')), { assignmentId: next!.id, answers: { testimony: 'Peace in the night.' }, anonymous: true });

    // An anonymous report is never tied to its author, except for the pastoral team.
    await expect(getAssignmentReport(db, office(at('2026-09-21', '09:00')), { assignmentId: next!.id })).rejects.toMatchObject({ code: 'NOT_FOUND' });
    expect((await getAssignmentReport(db, pastor(at('2026-09-21', '09:00')), { assignmentId: next!.id })).anonymous).toBe(true);
    const board = await getChainBoard(db, office(at('2026-09-21', '09:00')), { chainId, date: '2026-09-21' });
    expect(board.slots.flatMap((s) => s.assignments).find((a) => a.id === next!.id)?.hasReport).toBe(false);
  });

  it('finds people to assign, with those who already pray in the chain first', async () => {
    const now = at('2026-09-21', '09:00');
    const pool = (await searchAssignablePeople(db, office(now), { chainId, q: '' })).map((p) => p.name);
    expect(pool).toEqual(expect.arrayContaining(['John Cruz', 'Grace Mendoza', 'Anna Lim']));
    expect(pool).not.toContain('Eduardo Villanueva');
    const [first] = await searchAssignablePeople(db, office(now), { chainId, q: 'anna' });
    expect(first).toMatchObject({ name: 'Anna Lim', inPool: true });
  });

  it('reports chain completion by day and by person, only for chains in scope (FR-RPT-02)', async () => {
    const now = at('2026-09-22', '12:00');
    const reporter = userContext({ id: adminUserId }, ([...COORDINATOR, 'reports.view', 'reports.export'] as PermissionKey[]).map(globalGrant), now);

    const report = await getPrayerCompletionReport(db, reporter, { chainId, from: '2026-09-20', to: '2026-09-30' });
    if (!report.chain) throw new Error('Expected the Night and Day report');
    expect(report).toMatchObject({ from: '2026-09-20', to: '2026-09-22', today: '2026-09-22' }); // never past today
    expect(report.days.map((d) => [d.date, d.slots, d.covered, d.prayed])).toEqual([
      ['2026-09-20', 24, 2, 2], // John and Anna prayed; Grace was excused
      ['2026-09-21', 24, 1, 1], // John took Mark's slot; Michael was taken off by mistake
      ['2026-09-22', 24, 1, 0], // Samuel's slot, not marked yet
    ]);
    expect(report.totals).toEqual({ slots: 72, covered: 4, prayed: 3, completed: 3, late: 1, followUp: 0, missed: 0, excused: 1 });
    const byName = Object.fromEntries(report.people.map((p) => [p.name, p]));
    expect(byName['John Cruz']).toMatchObject({ slots: 2, completed: 2, late: 0 });
    expect(byName['Anna Lim']).toMatchObject({ slots: 1, completed: 1, late: 1 });
    expect(byName['Grace Mendoza']).toMatchObject({ slots: 1, completed: 0, excused: 1 });
    expect(byName['Mark Santos']).toMatchObject({ slots: 0, handedOver: 1 });
    expect(report.people.some((p) => p.name.startsWith('Michael'))).toBe(false);

    const { filename, csv } = await exportPrayerReport(db, reporter, { chainId, from: '2026-09-20', to: '2026-09-22' }, 'days');
    expect(filename).toBe('prayer-days-2026-09-20-to-2026-09-22.csv');
    expect(csv.replace(/^﻿/, '').split('\r\n')).toEqual([
      'Date,Slots,Covered,Prayed,Finished,Finished late,Needs follow-up,Missed,Excused',
      '2026-09-20,24,2,2,2,1,0,0,1',
      '2026-09-21,24,1,1,1,0,0,0,0',
      '2026-09-22,24,1,0,0,0,0,0,0',
    ]);
    expect(await db.select().from(auditLogs).where(and(eq(auditLogs.action, 'report.exported'), eq(auditLogs.entityId, 'prayer_days')))).toHaveLength(1);

    // The coordinator of another chain sees only their own chain (docs/06 T14).
    const vigilReporter = userContext(
      { id: adminUserId },
      ([...COORDINATOR, 'reports.view'] as PermissionKey[]).map(
        (permission): Grant => ({ permission, scope: { type: 'prayer_chain', chainId: vigilChainId }, roleKey: 'prayer_coordinator' }),
      ),
      now,
    );
    await expect(getPrayerCompletionReport(db, vigilReporter, { chainId })).rejects.toMatchObject({ code: 'NOT_FOUND' });
    const own = await getPrayerCompletionReport(db, vigilReporter, {});
    expect(own.chains.map((c) => c.name)).toEqual(['Friday Vigil']);
    expect(own.chain?.id).toBe(vigilChainId);
    await expect(getPrayerCompletionReport(db, office(now), {})).rejects.toMatchObject({ code: 'FORBIDDEN' });
  });

  it('lets someone take an open hour for themselves, once the coordinator opens the chain', async () => {
    const now = at('2026-09-21', '09:00');
    const key = await issueParticipantKey(db, { personId: world.ids.grace, createdVia: 'phone_match', persistent: true, now, userAgent: null });
    const grace = (await resolveParticipantKey(db, key.secret, now))!;
    const free = await slotAt('2026-09-22', '05:00');

    // Off by default: hours are the coordinator's to give until they say otherwise.
    expect(await failure(claimSlot(db, grace, req(now), { code: chainCode, slotId: free.id }))).toMatchObject({ code: 'INVALID_STATE' });

    await updateChain(db, office(now), { ...chainSettings, allowSelfSignup: true });
    const taken = await claimSlot(db, grace, req(now), { code: chainCode, slotId: free.id });
    if (taken.result !== 'claimed') throw new Error('Expected Grace to take the hour');
    expect(taken.slot).toMatchObject({ state: 'upcoming', primaryAction: 'confirm' });

    const [row] = await db.select().from(prayerAssignments).where(eq(prayerAssignments.slotId, free.id));
    expect(row).toMatchObject({ personId: world.ids.grace, source: 'self_signup', createdBy: null });
    const [event] = await db.select().from(prayerAssignmentEvents).where(eq(prayerAssignmentEvents.assignmentId, row!.id));
    expect(event).toMatchObject({ eventType: 'assigned', actorType: 'participant', via: 'chain_page' });
    const [logged] = await db.select().from(auditLogs).where(eq(auditLogs.action, 'prayer.self_signed_up'));
    expect(logged).toMatchObject({ entityId: chainId, actorPersonId: world.ids.grace });
  });

  it('refuses an hour that is full, already passed, or clashes with another chain', async () => {
    const now = at('2026-09-21', '09:00');
    const key = await issueParticipantKey(db, { personId: world.ids.anna, createdVia: 'phone_match', persistent: true, now, userAgent: null });
    const anna = (await resolveParticipantKey(db, key.secret, now))!;

    const graceHour = await slotAt('2026-09-22', '05:00');
    expect(await failure(claimSlot(db, anna, req(now), { code: chainCode, slotId: graceHour.id }))).toMatchObject({ code: 'CONFLICT', reason: 'CAPACITY_FULL' });

    const past = await slotAt('2026-09-20', '02:00');
    expect(await failure(claimSlot(db, anna, req(now), { code: chainCode, slotId: past.id }))).toMatchObject({ code: 'CONFLICT', reason: 'SLOT_CLOSED' });

    // An hour in a different chain can't be reached with this chain's code.
    const vigilSlot = await slotAt('2026-09-20', '02:30', vigilChainId);
    expect(await failure(claimSlot(db, anna, req(now), { code: chainCode, slotId: vigilSlot.id }))).toMatchObject({ code: 'NOT_FOUND' });
  });

  it('offers to keep or move an hour rather than quietly giving someone two', async () => {
    const now = at('2026-09-21', '09:00');
    const key = await issueParticipantKey(db, { personId: world.ids.grace, createdVia: 'phone_match', persistent: true, now, userAgent: null });
    const grace = (await resolveParticipantKey(db, key.secret, now))!;
    const held = await slotAt('2026-09-22', '05:00');
    const wanted = await slotAt('2026-09-22', '21:00');

    const again = await claimSlot(db, grace, req(now), { code: chainCode, slotId: wanted.id });
    if (again.result !== 'already_assigned') throw new Error('Expected Grace to be told she already has an hour');
    expect(again.current.slotLabel).toContain('5:00 AM');

    const [before] = await db.select().from(prayerAssignments).where(eq(prayerAssignments.slotId, held.id));
    const moved = await claimSlot(db, grace, req(now), { code: chainCode, slotId: wanted.id, replaceAssignmentId: before!.id });
    expect(moved.result).toBe('claimed');
    expect((await assignment(before!.id)).status).toBe('cancelled');
    const [after] = await db.select().from(prayerAssignments).where(eq(prayerAssignments.slotId, wanted.id));
    expect(after).toMatchObject({ personId: world.ids.grace, status: 'scheduled', source: 'self_signup' });
  });

  it('shows every hour of the day publicly, without saying who unless the chain allows it', async () => {
    const now = at('2026-09-22', '05:30');
    const page = await getChainPage(db, { code: chainCode, date: '2026-09-22' }, null, now);
    if (page.status !== 'ok') throw new Error('Expected the chain page');
    const { schedule } = page;

    expect(schedule).toMatchObject({ date: '2026-09-22', previousDate: '2026-09-21', nextDate: '2026-09-23', selfSignup: true });
    expect(schedule.slots).toHaveLength(24);
    expect(schedule.summary.total).toBe(24);
    expect(schedule.summary.available + schedule.summary.covered + schedule.summary.unfilled).toBe(24);

    const fiveAm = schedule.slots.find((slot) => slot.startsAt.getTime() === at('2026-09-22', '05:00').getTime())!;
    // Grace moved away from it and it is running right now, so anyone could still take it.
    expect(fiveAm).toMatchObject({ state: 'open_now', claimable: true, names: null });
    const nineAm = schedule.slots.find((slot) => slot.startsAt.getTime() === at('2026-09-22', '09:00').getTime())!;
    expect(nineAm).toMatchObject({ state: 'available', claimable: true, placesLeft: 1 });
    const ninePm = schedule.slots.find((slot) => slot.startsAt.getTime() === at('2026-09-22', '21:00').getTime())!;
    expect(ninePm).toMatchObject({ state: 'reserved', claimable: false, names: null, mine: false });

    // Only when the coordinator publishes them, and only first names.
    await updateChain(db, office(now), { ...chainSettings, allowSelfSignup: true, showNamesPublicly: true });
    const named = await getChainPage(db, { code: chainCode, date: '2026-09-22' }, null, now);
    if (named.status !== 'ok') throw new Error('Expected the chain page');
    expect(named.schedule.slots.find((slot) => slot.startsAt.getTime() === at('2026-09-22', '21:00').getTime())?.names).toEqual(['Grace']);
  });
});
