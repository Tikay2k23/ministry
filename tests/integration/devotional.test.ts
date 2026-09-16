import { and, asc, eq, like } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { RequestContext } from '@/server/context/request-context';
import type { DatabaseHandle } from '@/server/db/client';
import { careFollowups, gatheringAssignments, gatherings, ministries, notifications, teams } from '@/server/db/schema';
import { getDevotionalCalendar, getDevotionalOverview } from '@/server/modules/devotional/calendar.service';
import { sendServingReminders } from '@/server/modules/devotional/devotional-jobs.service';
import { createGatheringType, getGatheringTypeSetup, listGatheringTypes, setRosterTemplate } from '@/server/modules/devotional/gathering-types.service';
import { generateUpcomingGatherings } from '@/server/modules/devotional/generation.service';
import { getServingByActionLink, respondToServing } from '@/server/modules/devotional/participation.service';
import {
  assignServing,
  cancelGathering,
  createOneOffGathering,
  getGatheringRoster,
  publishRosters,
  removeServingAssignment,
  shareServingLink,
  substituteServing,
  suggestServingSubstitutes,
  updateGatheringDetails,
} from '@/server/modules/devotional/roster.service';
import { createGatheringSchedule, endGatheringSchedule } from '@/server/modules/devotional/schedules.service';
import { listServingRoles } from '@/server/modules/devotional/serving-roles.service';
import { addWorshipTeamMember, createWorshipTeam, setMemberServingRoles } from '@/server/modules/devotional/teams.service';
import { addUnavailability } from '@/server/modules/devotional/unavailability.service';
import { zonedInstant } from '@/server/modules/journal/journal-dates';
import type { PermissionKey } from '@/server/policy/catalog';
import type { Grant } from '@/server/policy/grants';
import { createTestDatabase } from '../helpers/db';
import { userContext } from '../helpers/fixtures';
import { buildWorld } from '../helpers/world';

const TZ = 'Asia/Manila';
const at = (date: string, time: string) => zonedInstant(date, time, TZ);
const req = (now: Date) => ({ now, ip: '203.0.113.40', userAgent: 'Mozilla/5.0 (Linux; Android 14) Chrome/120 Mobile' });
const tokenOf = (url: string) => url.split('/a/')[1]!;

let handle: DatabaseHandle;
let db: DatabaseHandle['db'];
let world: Awaited<ReturnType<typeof buildWorld>>;
let adminUserId: string;
let dawnTypeId: string;
let scheduleId: string;
const roleIds = new Map<string, string>();

const SETUP_NOW = at('2026-09-20', '10:00');
const adminAt = (now: Date): RequestContext => ({ ...world.admin, now });
const roleId = (key: string) => roleIds.get(key)!;

async function gatheringOn(date: string) {
  const [row] = await db
    .select({ id: gatherings.id })
    .from(gatherings)
    .where(and(eq(gatherings.scheduleId, scheduleId), eq(gatherings.occursOn, date)));
  if (!row) throw new Error(`No gathering on ${date}`);
  return row.id;
}

const rosterOn = async (date: string, now = SETUP_NOW) => getGatheringRoster(db, adminAt(now), { gatheringId: await gatheringOn(date) });
const namesIn = (roster: Awaited<ReturnType<typeof getGatheringRoster>>, roleName: string) =>
  roster.roles.find((r) => r.name === roleName)!.assignments.map((a) => a.name);
const noticesFor = (templateKey: string) => db.select().from(notifications).where(eq(notifications.templateKey, templateKey));

const failure = (promise: Promise<unknown>) =>
  promise.then(
    () => null,
    (error: { code?: string; details?: { meta?: { reason?: string } } }) => ({ code: error.code, reason: error.details?.meta?.reason }),
  );

beforeAll(async () => {
  handle = await createTestDatabase();
  db = handle.db;
  world = await buildWorld(db);
  adminUserId = world.admin.actor.kind === 'user' ? world.admin.actor.userId : '';

  for (const role of await listServingRoles(db, adminAt(SETUP_NOW))) roleIds.set(role.key, role.id);
  const [ministry] = await db.insert(ministries).values({ name: 'Worship Ministry', code: 'WORSHIP' }).returning({ id: ministries.id });

  // A small template: a worship leader and a keyboard are needed; a backup vocal is welcome.
  dawnTypeId = (
    await createGatheringType(db, adminAt(SETUP_NOW), { name: 'Dawn Worship', defaultStartTime: '06:00', defaultDurationMinutes: 60, ministryId: ministry!.id, responseLockHours: 12 })
  ).gatheringTypeId;
  await setRosterTemplate(db, adminAt(SETUP_NOW), {
    gatheringTypeId: dawnTypeId,
    roles: [
      { servingRoleId: roleId('worship_leader'), minCount: 1, maxCount: 1 },
      { servingRoleId: roleId('keyboard'), minCount: 1, maxCount: 1 },
      { servingRoleId: roleId('backup_vocal'), minCount: 0, maxCount: 1 },
    ],
  });

  // Team A: Mark leads, John and Anna both play keyboard (Anna also sings). Team B: Samuel and Grace. Team C: only Michael.
  const team = async (name: string, members: [string, string[], string][]) => {
    const { teamId } = await createWorshipTeam(db, adminAt(SETUP_NOW), { ministryId: ministry!.id, name });
    for (const [personId, roles, primary] of members) {
      const { teamMembershipId } = await addWorshipTeamMember(db, adminAt(SETUP_NOW), { teamId, personId });
      await setMemberServingRoles(db, adminAt(SETUP_NOW), { teamMembershipId, servingRoleIds: roles.map(roleId), primaryRoleId: roleId(primary) });
    }
    return teamId;
  };
  const teamA = await team('Team A', [
    [world.ids.mark, ['worship_leader'], 'worship_leader'],
    [world.ids.john, ['keyboard'], 'keyboard'],
    [world.ids.anna, ['keyboard', 'backup_vocal'], 'keyboard'],
  ]);
  const teamB = await team('Team B', [
    [world.ids.samuel, ['worship_leader'], 'worship_leader'],
    [world.ids.grace, ['keyboard'], 'keyboard'],
  ]);
  const teamC = await team('Team C', [[world.ids.michael, ['worship_leader'], 'worship_leader']]);

  // Monday to Saturday at 6:00 AM, the teams taking turns week by week from Monday 21 September (docs/05 W8).
  const created = await createGatheringSchedule(db, adminAt(SETUP_NOW), {
    gatheringTypeId: dawnTypeId,
    name: 'Weekday dawn worship',
    rrule: 'FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR,SA',
    startTime: '06:00',
    durationMinutes: 60,
    effectiveFrom: '2026-09-21',
    rotationMode: 'weekly',
    teamIds: [teamA, teamB, teamC],
    rotationAnchor: '2026-09-21',
    generateDaysAhead: 28,
  });
  scheduleId = created.scheduleId;
  expect(created.generated.gatheringsCreated).toBe(24);
});

afterAll(async () => {
  await handle.close();
});

describe('devotional and worship (M4)', () => {
  it('starts with the serving roles and the Morning Devotional roster template', async () => {
    expect([...roleIds.keys()]).toEqual(expect.arrayContaining(['worship_leader', 'lead_vocal', 'keyboard', 'prayer_leader', 'sound']));
    const morning = (await listGatheringTypes(db, adminAt(SETUP_NOW))).find((t) => t.name === 'Morning Devotional')!;
    const setup = await getGatheringTypeSetup(db, adminAt(SETUP_NOW), morning.id);
    expect(setup.type).toMatchObject({ defaultStartTime: '06:00', defaultDurationMinutes: 60, responseLockHours: 12 });
    expect(setup.template).toHaveLength(12);
    expect(setup.template.find((r) => r.name === 'Backup Vocal')).toMatchObject({ minCount: 2, maxCount: 2 });
    expect(setup.template.find((r) => r.name === 'Bass')).toMatchObject({ minCount: 0, maxCount: 1 });
  });

  it('generates four weeks with the teams taking turns week by week (M4 exit criterion)', async () => {
    const rows = await db
      .select({ occursOn: gatherings.occursOn, team: teams.name, startsAt: gatherings.startsAt })
      .from(gatherings)
      .innerJoin(teams, eq(teams.id, gatherings.teamId))
      .where(eq(gatherings.scheduleId, scheduleId))
      .orderBy(asc(gatherings.occursOn));
    const teamOn = Object.fromEntries(rows.map((r) => [r.occursOn, r.team]));
    expect(rows).toHaveLength(24);
    expect(
      ['2026-09-21', '2026-09-26', '2026-09-28', '2026-10-03', '2026-10-05', '2026-10-10', '2026-10-12', '2026-10-17'].map((date) => teamOn[date]),
    ).toEqual(['Team A', 'Team A', 'Team B', 'Team B', 'Team C', 'Team C', 'Team A', 'Team A']);
    expect(teamOn['2026-09-27']).toBeUndefined(); // no Sundays
    expect(rows[0]!.startsAt).toEqual(new Date('2026-09-20T22:00:00.000Z')); // 6:00 AM in Manila
  });

  it('fills each roster from the team’s default roles, taking turns and reporting open roles', async () => {
    const monday = await rosterOn('2026-09-21');
    expect(namesIn(monday, 'Worship Leader')).toEqual(['Mark Santos']);
    expect(namesIn(monday, 'Keyboard')).toEqual(['John Cruz']);
    expect(namesIn(monday, 'Backup Vocal')).toEqual(['Anna Lim']);
    expect(monday.summary).toEqual({ confirmed: 0, pending: 3, declined: 0, openRequired: 0 });

    // Anna hasn't played keyboard yet, so it's her turn; nobody doubles up for the optional vocal.
    const tuesday = await rosterOn('2026-09-22');
    expect(namesIn(tuesday, 'Keyboard')).toEqual(['Anna Lim']);
    expect(namesIn(tuesday, 'Backup Vocal')).toEqual([]);
    expect(namesIn(await rosterOn('2026-09-23'), 'Keyboard')).toEqual(['John Cruz']);

    const teamC = await rosterOn('2026-10-05');
    expect(teamC.gathering).toMatchObject({ teamName: 'Team C', published: false });
    expect(teamC.roles.find((r) => r.name === 'Keyboard')).toMatchObject({ open: 1, assignments: [] });
    expect(teamC.summary.openRequired).toBe(1);
  });

  it('never touches an existing gathering again, so manual edits survive (M4 exit criterion)', async () => {
    const thursday = await gatheringOn('2026-09-24');
    const before = await rosterOn('2026-09-24');
    await removeServingAssignment(db, adminAt(SETUP_NOW), { assignmentId: before.roles.find((r) => r.name === 'Keyboard')!.assignments[0]!.id });
    const assigned = await assignServing(db, adminAt(SETUP_NOW), { gatheringId: thursday, servingRoleId: roleId('keyboard'), personId: world.ids.grace });
    expect(assigned.warnings.map((w) => w.code)).toEqual(['NOT_TEAM_MEMBER']);
    await updateGatheringDetails(db, adminAt(SETUP_NOW), { gatheringId: thursday, title: 'Dawn Worship: Missions week' });

    // A week later the window moves on: six new gatherings, and nothing else changes.
    const regenerated = await generateUpcomingGatherings(db, at('2026-09-27', '10:00'));
    expect(regenerated.gatheringsCreated).toBe(6);
    const after = await rosterOn('2026-09-24');
    expect(after.gathering.name).toBe('Dawn Worship: Missions week');
    expect(namesIn(after, 'Keyboard')).toEqual(['Grace Mendoza']);
    expect(await generateUpcomingGatherings(db, at('2026-09-27', '10:05'))).toMatchObject({ gatheringsCreated: 0, assignmentsCreated: 0 });
  });

  it('publishes rosters, holding back open required roles until asked twice, and tells each person once', async () => {
    const tuesday = await gatheringOn('2026-09-22');
    const teamCMonday = await gatheringOn('2026-10-05');
    const first = await publishRosters(db, adminAt(SETUP_NOW), { gatheringIds: [tuesday, teamCMonday] });
    expect(first.published).toEqual([tuesday]);
    expect(first.needsForce).toEqual([expect.objectContaining({ gatheringId: teamCMonday, openRoles: ['Keyboard'] })]);

    const forced = await publishRosters(db, adminAt(SETUP_NOW), { gatheringIds: [teamCMonday], force: true });
    expect(forced.published).toEqual([teamCMonday]);
    expect((await noticesFor('devotional.assigned')).map((n) => n.recipientPersonId).sort()).toEqual([world.ids.anna, world.ids.mark, world.ids.michael].sort());
    expect(await publishRosters(db, adminAt(SETUP_NOW), { gatheringIds: [tuesday] })).toMatchObject({ published: [], skipped: 1 });
  });

  it('lets the person accept or decline with their link, and change their mind until the lock time', async () => {
    const anna = (await rosterOn('2026-09-22')).roles.find((r) => r.name === 'Keyboard')!.assignments[0]!;
    const token = tokenOf((await shareServingLink(db, adminAt(SETUP_NOW), { assignmentId: anna.id })).url);

    const page = await getServingByActionLink(db, token, at('2026-09-20', '11:00'));
    expect(page).toMatchObject({ status: 'ok', firstName: 'Anna', view: { gatheringName: 'Dawn Worship', roleName: 'Keyboard', teamName: 'Team A', state: 'pending', canRespond: true } });
    expect(page.status === 'ok' ? page.view.roster : []).toEqual([
      { roleName: 'Worship Leader', names: ['Mark'] },
      { roleName: 'Keyboard', names: ['Anna'] },
    ]);

    expect((await respondToServing(db, req(at('2026-09-20', '11:00')), { token, response: 'accept' })).view.state).toBe('confirmed');
    const declined = await respondToServing(db, req(at('2026-09-21', '09:00')), { token, response: 'decline', note: 'Our child is unwell' });
    expect(declined.view).toMatchObject({ state: 'declined', responseNote: 'Our child is unwell', canRespond: true });

    const [followUp] = await db.select().from(careFollowups).where(eq(careFollowups.dedupeKey, `serving_declined:${anna.id}`));
    expect(followUp).toMatchObject({ kind: 'serving_declined', status: 'open', personId: world.ids.anna });
    expect((await noticesFor('devotional.declined')).map((n) => n.recipientUserId)).toEqual([adminUserId]);

    // Within 12 hours of the 6:00 AM start, the reply can't be changed from the link any more.
    expect(await failure(respondToServing(db, req(at('2026-09-21', '19:00')), { token, response: 'accept' }))).toEqual({ code: 'INVALID_STATE', reason: 'LOCKED' });
    const locked = await getServingByActionLink(db, token, at('2026-09-21', '19:00'));
    expect(locked.status === 'ok' ? locked.view : null).toMatchObject({ canRespond: false, lockedMessage: expect.stringContaining('contact your coordinator') });
  });

  it('suggests free substitutes who play the role, and hands the place over kindly', async () => {
    const tuesday = await gatheringOn('2026-09-22');
    const anna = (await rosterOn('2026-09-22')).roles.find((r) => r.name === 'Keyboard')!.assignments[0]!;
    const annaToken = tokenOf((await shareServingLink(db, adminAt(at('2026-09-21', '09:10')), { assignmentId: anna.id })).url);

    // Grace plays keyboard too, but she is away that day.
    const away = await addUnavailability(db, adminAt(at('2026-09-21', '09:20')), { personId: world.ids.grace, from: '2026-09-22', to: '2026-09-22', reason: 'Travelling' });
    expect(away.affected).toEqual([]);
    const suggestions = await suggestServingSubstitutes(db, adminAt(at('2026-09-21', '09:30')), { assignmentId: anna.id });
    expect(suggestions.map((s) => s.name)).toEqual(['John Cruz']);
    expect(suggestions[0]!.reasons).toEqual(['On Team A', 'Free at this time', 'Last served as Keyboard on Mon, Sep 21']);

    const swap = await substituteServing(db, adminAt(at('2026-09-21', '09:35')), { assignmentId: anna.id, personId: world.ids.john });
    expect(await db.select({ status: gatheringAssignments.status }).from(gatheringAssignments).where(eq(gatheringAssignments.id, anna.id))).toEqual([{ status: 'replaced' }]);
    const [closed] = await db.select().from(careFollowups).where(eq(careFollowups.dedupeKey, `serving_declined:${anna.id}`));
    expect(closed?.status).toBe('resolved');
    // The roster was published, so John is told; Anna asked for this, so she gets no "removed" notice.
    expect((await noticesFor('devotional.assigned')).some((n) => n.dedupeKey === `serving_assigned:${swap.substituteAssignmentId}`)).toBe(true);
    expect(await noticesFor('devotional.assignment_removed')).toHaveLength(0);
    expect(await getServingByActionLink(db, annaToken, at('2026-09-21', '09:40'))).toEqual({ status: 'reassigned', gatheringName: 'Dawn Worship' });
    expect(namesIn(await getGatheringRoster(db, adminAt(at('2026-09-21', '09:40')), { gatheringId: tuesday }), 'Keyboard')).toEqual(['John Cruz']);
  });

  it('cancels a gathering: everyone comes off the roster and confirmed people are told', async () => {
    const wednesday = await gatheringOn('2026-09-23');
    await publishRosters(db, adminAt(SETUP_NOW), { gatheringIds: [wednesday] });
    const mark = (await rosterOn('2026-09-23')).roles.find((r) => r.name === 'Worship Leader')!.assignments[0]!;
    const token = tokenOf((await shareServingLink(db, adminAt(SETUP_NOW), { assignmentId: mark.id })).url);
    await respondToServing(db, req(at('2026-09-21', '10:00')), { token, response: 'accept' });

    expect(await cancelGathering(db, adminAt(at('2026-09-21', '12:00')), { gatheringId: wednesday, reason: 'Typhoon signal no. 2' })).toEqual({ gatherings: 1, notified: 1 });
    const statuses = await db.select({ status: gatheringAssignments.status }).from(gatheringAssignments).where(eq(gatheringAssignments.gatheringId, wednesday));
    expect(new Set(statuses.map((s) => s.status))).toEqual(new Set(['cancelled']));
    expect((await noticesFor('devotional.cancelled')).map((n) => n.recipientPersonId)).toEqual([world.ids.mark]);
    expect(await getServingByActionLink(db, token, at('2026-09-21', '12:05'))).toMatchObject({ status: 'cancelled', reason: 'Typhoon signal no. 2' });
  });

  it('reminds people who haven’t replied 72 and 24 hours before, once each, and tells coordinators about open roles', async () => {
    const michael = (await rosterOn('2026-10-05')).roles.find((r) => r.name === 'Worship Leader')!.assignments[0]!;
    expect(await sendServingReminders(db, at('2026-10-02', '07:00'))).toEqual({ threeDays: 1, oneDay: 0, openRoleNotices: 0 });
    expect(await sendServingReminders(db, at('2026-10-02', '07:15'))).toEqual({ threeDays: 0, oneDay: 0, openRoleNotices: 0 });
    expect(await sendServingReminders(db, at('2026-10-04', '07:00'))).toEqual({ threeDays: 0, oneDay: 1, openRoleNotices: 1 });
    expect(await sendServingReminders(db, at('2026-10-04', '07:15'))).toEqual({ threeDays: 0, oneDay: 0, openRoleNotices: 0 });

    const reminders = await db.select({ key: notifications.dedupeKey }).from(notifications).where(like(notifications.dedupeKey, 'serving_reminder:%'));
    expect(reminders.map((r) => r.key).sort()).toEqual([`serving_reminder:${michael.id}:24h`, `serving_reminder:${michael.id}:72h`]);
    expect((await noticesFor('devotional.unfilled')).map((n) => n.recipientUserId)).toEqual([adminUserId]);
  });

  it('shows the week with reply counts and open roles, and what needs attention on the dashboard', async () => {
    const now = at('2026-10-04', '07:30');
    const calendar = await getDevotionalCalendar(db, adminAt(now), { week: '2026-10-07', gatheringTypeId: dawnTypeId });
    expect(calendar).toMatchObject({ weekStart: '2026-10-05', weekEnd: '2026-10-11', previousWeek: '2026-09-28', nextWeek: '2026-10-12' });
    expect(calendar.days.map((d) => d.gatherings.length)).toEqual([1, 1, 1, 1, 1, 1, 0]);
    expect(calendar.days[0]!.gatherings[0]).toMatchObject({ teamName: 'Team C', published: true, pending: 1, openRequired: 1, needsAttention: true, canManage: true });
    expect(calendar.unpublishedIds).toHaveLength(5);

    const overview = await getDevotionalOverview(db, adminAt(now));
    expect(overview?.upcoming[0]).toMatchObject({ occursOn: '2026-10-05', name: 'Dawn Worship' });
    expect(overview?.attention).toEqual(expect.arrayContaining([expect.objectContaining({ label: 'Dawn Worship, Mon, Oct 5: 1 role still open' })]));
  });

  it('keeps a worship coordinator to their own gathering type (docs/06 T14)', async () => {
    const morning = (await listGatheringTypes(db, adminAt(SETUP_NOW))).find((t) => t.name === 'Morning Devotional')!;
    const coordinator = userContext(
      { id: adminUserId },
      (['devotional.view', 'devotional.manage', 'devotional.teams.manage', 'people.view'] as PermissionKey[]).map(
        (permission): Grant => ({ permission, scope: { type: 'gathering_type', gatheringTypeId: morning.id }, roleKey: 'worship_coordinator' }),
      ),
      at('2026-09-28', '08:00'),
    );
    const dawn = await gatheringOn('2026-09-29');

    // Every roster can be read, but only their own gathering type can be changed.
    expect((await getGatheringRoster(db, coordinator, { gatheringId: dawn })).can.manage).toBe(false);
    expect(await failure(assignServing(db, coordinator, { gatheringId: dawn, servingRoleId: roleId('host'), personId: world.ids.samuel }))).toMatchObject({ code: 'NOT_FOUND' });
    expect(await failure(createGatheringType(db, coordinator, { name: 'Sunday Service', defaultStartTime: '09:00', defaultDurationMinutes: 120, responseLockHours: 24 }))).toMatchObject({ code: 'FORBIDDEN' });

    const oneOff = await createOneOffGathering(db, coordinator, { gatheringTypeId: morning.id, date: '2026-10-01', startTime: '06:00', durationMinutes: 60 });
    expect(oneOff.gaps.map((g) => g.roleName)).toContain('Backup Vocal');
    expect(oneOff.gaps.find((g) => g.roleName === 'Backup Vocal')).toMatchObject({ missing: 2 });
  });

  it('ends a schedule: its upcoming gatherings are cancelled and nothing new is generated', async () => {
    const ended = await endGatheringSchedule(db, adminAt(at('2026-10-10', '12:00')), { scheduleId });
    expect(ended.gatherings).toBe(12); // 12–17 and 19–24 October
    expect(await generateUpcomingGatherings(db, at('2026-10-11', '10:00'))).toMatchObject({ gatheringsCreated: 0 });
  });
});
