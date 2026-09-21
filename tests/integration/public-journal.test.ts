import { randomUUID } from 'node:crypto';
import { and, eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { DatabaseHandle } from '@/server/db/client';
import {
  careFollowups,
  journalDays,
  journalEntries,
  leaderChangeRequests,
  people,
  personDuplicateCandidates,
} from '@/server/db/schema';
import { publishFormDraft, saveFormDraft, getPublishedForm, JOURNAL_FORM_KEY } from '@/server/modules/forms/forms.service';
import { zonedInstant } from '@/server/modules/journal/journal-dates';
import { editJournal, getOwnEntryForEdit, getPublicJournalState, submitJournal } from '@/server/modules/journal/journal-submit.service';
import { setAcceptsMembers } from '@/server/modules/hierarchy/hierarchy.service';
import { ensureLeaderEntryCode, resolveEntryCode } from '@/server/modules/public/entry-codes.service';
import {
  assertFormSession,
  identifyParticipant,
  installPersonalLink,
  issueFormSession,
  issuePersonalLink,
  registerParticipant,
  resolveParticipantKey,
  revokeParticipantKeys,
  searchPublicLeaders,
} from '@/server/modules/public/participants.service';
import type { PublicRequest } from '@/server/modules/public/public-request';
import { archivePerson } from '@/server/modules/people/people.service';
import { getSetting, updateSetting } from '@/server/modules/settings/settings.service';
import { createTestDatabase } from '../helpers/db';
import { globalGrant, userContext } from '../helpers/fixtures';
import { buildWorld } from '../helpers/world';

const at = (date: string, time: string) => zonedInstant(date, time, 'Asia/Manila');
const req = (now: Date, ip = '203.0.113.10'): PublicRequest => ({ now, ip, userAgent: 'Mozilla/5.0 (Linux; Android 14) Chrome/120 Mobile' });

let handle: DatabaseHandle;
let db: DatabaseHandle['db'];
let world: Awaited<ReturnType<typeof buildWorld>>;
let markCode: string;
let annaCode: string;
let versionId: string;

const goodAnswers = { reflection: 'God is faithful.', prayed: true, scripture: 'Psalm 23' };

beforeAll(async () => {
  handle = await createTestDatabase();
  db = handle.db;
  world = await buildWorld(db);
  // These tests are about the journal itself, not the photo (tests/integration/journal-proof.test.ts),
  // so the ministry setting is left inviting a photo rather than insisting on one.
  await updateSetting(db, world.admin, 'journal.policy', { ...(await getSetting(db, 'journal.policy')), proofImage: 'optional' });
  await setAcceptsMembers(db, world.admin, { personId: world.ids.mark, acceptsMembers: true });
  await setAcceptsMembers(db, world.admin, { personId: world.ids.anna, acceptsMembers: true });
  markCode = (await ensureLeaderEntryCode(db, world.ids.mark)).code;
  annaCode = (await ensureLeaderEntryCode(db, world.ids.anna)).code;
  versionId = (await getPublishedForm(db, JOURNAL_FORM_KEY))!.versionId;

});

afterAll(async () => {
  await handle.close();
});

async function register(now: Date, overrides: Record<string, unknown> = {}) {
  return registerParticipant(db, req(now), {
    firstName: 'Carlo',
    lastName: 'Mendoza',
    phone: '0917 123 0001',
    leaderRef: markCode,
    consent: true,
    ...overrides,
  });
}

describe('registration and identification', () => {
  it('registers a newcomer as unconfirmed under the chosen leader and remembers the device', async () => {
    const now = at('2026-09-14', '07:00');
    const result = await register(now);
    expect(result.leaderName).toBe('Mark S.');

    const [person] = await db.select().from(people).where(eq(people.id, result.personId));
    expect(person).toMatchObject({ registrationStatus: 'unconfirmed', source: 'public_registration', phoneE164: '+639171230001' });
    expect(person!.consentAt).not.toBeNull();

    const identity = await resolveParticipantKey(db, result.key.secret, now);
    expect(identity).toMatchObject({ personId: result.personId, channel: 'registration', persistent: true });
  });

  it('refuses a second registration with the same mobile and name, and honeypot submissions', async () => {
    const now = at('2026-09-14', '07:05');
    await expect(register(now)).rejects.toMatchObject({ code: 'CONFLICT', details: { meta: { reason: 'ALREADY_REGISTERED' } } });
    await expect(register(now, { firstName: 'Bot', website: 'http://spam' })).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
  });

  it('needs guardian consent for minors', async () => {
    const now = at('2026-09-14', '07:06');
    await expect(
      register(now, { firstName: 'Teen', lastName: 'Reyes', phone: '0917 123 0009', birthYear: 2012 }),
    ).rejects.toMatchObject({ code: 'VALIDATION_ERROR', details: { fieldErrors: { guardianName: expect.any(Array) } } });
    await expect(
      register(now, { firstName: 'Teen', lastName: 'Reyes', phone: '0917 123 0009', birthYear: 2012, guardianName: 'Mom Reyes', guardianConsent: true }),
    ).resolves.toMatchObject({ firstName: 'Teen' });
  });

  it('recognises a returning person by mobile + first name, without fuzzy matching', async () => {
    const now = at('2026-09-14', '07:10');
    const hit = await identifyParticipant(db, req(now, '198.51.100.1'), { phone: '+63 917 123 0001', firstName: 'carlo', rememberDevice: false });
    expect(hit).toMatchObject({ result: 'identified', key: { persistent: false } });
    const miss = await identifyParticipant(db, req(now, '198.51.100.1'), { phone: '0917 123 0001', firstName: 'Carl' });
    expect(miss).toEqual({ result: 'not_confirmed' });
  });

  it('sends people who share a phone and first name to their leader for a personal link', async () => {
    const now = at('2026-09-14', '07:12');
    await register(now, { firstName: 'Joy', lastName: 'Cruz', phone: '0917 555 7777' });
    await register(now, { firstName: 'Joy', lastName: 'Santos', phone: '0917 555 7777' });
    const result = await identifyParticipant(db, req(now, '198.51.100.2'), { phone: '0917 555 7777', firstName: 'Joy' });
    expect(result).toEqual({ result: 'use_personal_link' });
    const shared = await db.select().from(personDuplicateCandidates);
    expect(shared.length).toBeGreaterThan(0);
  });

  it('rate-limits repeated guesses for one mobile number', async () => {
    const now = at('2026-09-14', '07:20');
    for (let i = 0; i < 5; i++) {
      await identifyParticipant(db, req(now, `192.0.2.${i}`), { phone: '0917 999 0000', firstName: `Guess${i}` });
    }
    await expect(
      identifyParticipant(db, req(now, '192.0.2.99'), { phone: '0917 999 0000', firstName: 'Again' }),
    ).rejects.toMatchObject({ code: 'RATE_LIMITED' });
  });

  it('issues single-use personal links and revokes remembered devices', async () => {
    const now = at('2026-09-14', '07:30');
    const link = await issuePersonalLink(db, world.admin, { personId: world.ids.john });
    const token = link.url.split('/k/')[1]!;
    const installed = await installPersonalLink(db, req(now), { token });
    expect((await resolveParticipantKey(db, installed.key.secret, now))?.personId).toBe(world.ids.john);
    await expect(installPersonalLink(db, req(now), { token })).rejects.toMatchObject({ code: 'GONE' });

    await revokeParticipantKeys(db, world.admin, { personId: world.ids.john });
    expect(await resolveParticipantKey(db, installed.key.secret, now)).toBeNull();
  });

  it('lists leaders publicly by first name and initial only', async () => {
    const results = await searchPublicLeaders(db, req(at('2026-09-14', '07:40')), 'mark');
    expect(results).toEqual([{ ref: markCode, name: 'Mark S.', hint: 'Michael’s branch' }]);
  });

  it('validates form sessions: forged, expired, too fast', () => {
    const now = at('2026-09-14', '08:00');
    const token = issueFormSession(now);
    expect(() => assertFormSession(token, new Date(now.getTime() + 5_000), { minFillMs: 2_000 })).not.toThrow();
    expect(() => assertFormSession(token, new Date(now.getTime() + 500), { minFillMs: 2_000 })).toThrow();
    expect(() => assertFormSession(`${token}x`, now)).toThrow();
    expect(() => assertFormSession(token, new Date(now.getTime() + 7 * 3_600_000))).toThrow();
  });
});

describe('journal submission', () => {
  async function johnIdentity(now: Date) {
    const link = await issuePersonalLink(db, world.admin, { personId: world.ids.john });
    const { key } = await installPersonalLink(db, req(now, '203.0.113.50'), { token: link.url.split('/k/')[1]! });
    return (await resolveParticipantKey(db, key.secret, now))!;
  }

  it('records one on-time entry, replays idempotently, and refuses a second journal', async () => {
    const now = at('2026-09-15', '06:30');
    const identity = await johnIdentity(now);
    const state = await getPublicJournalState(db, identity, now);
    // Before the 09:00 late cutoff, yesterday is still open.
    expect(state.dates.map((d) => d.label)).toEqual(['yesterday', 'today']);
    expect(state.leader?.name).toBe('Mark S.');

    const key = randomUUID();
    const receipt = await submitJournal(db, identity, req(now), { idempotencyKey: key, formVersionId: versionId, journalDate: '2026-09-15', answers: goodAnswers });
    expect(receipt).toMatchObject({ timing: 'on_time', revisionNo: 1, leaderName: 'Mark S.' });

    const replay = await submitJournal(db, identity, req(new Date(now.getTime() + 1000)), {
      idempotencyKey: key,
      formVersionId: versionId,
      journalDate: '2026-09-15',
      answers: goodAnswers,
    });
    expect(replay.receivedAt.getTime()).toBe(receipt.receivedAt.getTime());

    await expect(
      submitJournal(db, identity, req(now), { idempotencyKey: randomUUID(), formVersionId: versionId, journalDate: '2026-09-15', answers: goodAnswers }),
    ).rejects.toMatchObject({ code: 'CONFLICT', details: { meta: { reason: 'ALREADY_SUBMITTED', canEdit: true } } });

    const [dayRow] = await db.select().from(journalDays).where(and(eq(journalDays.personId, world.ids.john), eq(journalDays.journalDate, '2026-09-15')));
    expect(dayRow).toMatchObject({ submissionStatus: 'submitted', reviewStatus: 'awaiting', isExpected: true });
  });

  it('creates exactly one entry when the same person submits twice at once', async () => {
    const now = at('2026-09-15', '06:40');
    const link = await issuePersonalLink(db, world.admin, { personId: world.ids.grace });
    const { key } = await installPersonalLink(db, req(now, '203.0.113.51'), { token: link.url.split('/k/')[1]! });
    const identity = (await resolveParticipantKey(db, key.secret, now))!;

    const attempt = () =>
      submitJournal(db, identity, req(now), { idempotencyKey: randomUUID(), formVersionId: versionId, journalDate: '2026-09-15', answers: goodAnswers });
    const results = await Promise.allSettled([attempt(), attempt(), attempt()]);
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    const entries = await db.select().from(journalEntries).where(and(eq(journalEntries.personId, world.ids.grace), eq(journalEntries.journalDate, '2026-09-15')));
    expect(entries).toHaveLength(1);
  });

  it('accepts yesterday as late during the late window, then closes it', async () => {
    const link = await issuePersonalLink(db, world.admin, { personId: world.ids.anna });
    const { key } = await installPersonalLink(db, req(at('2026-09-16', '00:30'), '203.0.113.52'), { token: link.url.split('/k/')[1]! });
    const anna = (await resolveParticipantKey(db, key.secret, at('2026-09-16', '00:30')))!;
    const receipt = await submitJournal(db, anna, req(at('2026-09-16', '00:40')), {
      idempotencyKey: randomUUID(),
      formVersionId: versionId,
      journalDate: '2026-09-15',
      answers: goodAnswers,
    });
    expect(receipt.timing).toBe('late');
    await expect(
      submitJournal(db, anna, req(at('2026-09-16', '09:05')), { idempotencyKey: randomUUID(), formVersionId: versionId, journalDate: '2026-09-15', answers: goodAnswers }),
    ).rejects.toMatchObject({ code: 'INVALID_STATE', details: { meta: { reason: 'DAY_CLOSED' } } });
  });

  it('reports answer problems per question', async () => {
    const now = at('2026-09-16', '07:00');
    const identity = await johnIdentity(now);
    await expect(
      submitJournal(db, identity, req(now), { idempotencyKey: randomUUID(), formVersionId: versionId, journalDate: '2026-09-16', answers: { prayed: 'maybe' } }),
    ).rejects.toMatchObject({ code: 'VALIDATION_ERROR', details: { fieldErrors: { reflection: expect.any(Array), prayed: expect.any(Array) } } });
  });

  it('lets a remembered device edit before the deadline, never a session key or after the deadline', async () => {
    const now = at('2026-09-16', '07:10');
    const identity = await johnIdentity(now);
    await submitJournal(db, identity, req(now), { idempotencyKey: randomUUID(), formVersionId: versionId, journalDate: '2026-09-16', answers: goodAnswers });

    expect(await getOwnEntryForEdit(db, identity, '2026-09-16', now)).toMatchObject({ reflection: { t: 'text', v: 'God is faithful.' } });
    const edited = await editJournal(db, identity, req(at('2026-09-16', '21:00')), {
      idempotencyKey: randomUUID(),
      formVersionId: versionId,
      journalDate: '2026-09-16',
      answers: { ...goodAnswers, reflection: 'Updated reflection.' },
    });
    expect(edited.revisionNo).toBe(2);

    await expect(
      editJournal(db, identity, req(at('2026-09-17', '00:05')), { idempotencyKey: randomUUID(), formVersionId: versionId, journalDate: '2026-09-16', answers: goodAnswers }),
    ).rejects.toMatchObject({ code: 'INVALID_STATE', details: { meta: { reason: 'EDIT_WINDOW_CLOSED' } } });

    const session = await identifyParticipant(db, req(now, '203.0.113.60'), { phone: '0917 123 0001', firstName: 'Carlo', rememberDevice: false });
    if (session.result !== 'identified') throw new Error('expected identification');
    const sessionIdentity = (await resolveParticipantKey(db, session.key.secret, now))!;
    await expect(
      editJournal(db, sessionIdentity, req(now), { idempotencyKey: randomUUID(), formVersionId: versionId, journalDate: '2026-09-16', answers: goodAnswers }),
    ).rejects.toMatchObject({ details: { meta: { reason: 'EDIT_NOT_ALLOWED' } } });
    expect(await getOwnEntryForEdit(db, sessionIdentity, '2026-09-16', now)).toBeNull();
  });

  it('still accepts the previous question version briefly after new questions are published', async () => {
    const pastor = userContext({ id: world.admin.actor.kind === 'user' ? world.admin.actor.userId : '' }, [globalGrant('forms.manage'), globalGrant('forms.publish')], at('2026-09-17', '06:00'));
    const current = (await getPublishedForm(db, JOURNAL_FORM_KEY))!;
    await saveFormDraft(db, pastor, {
      formKey: JOURNAL_FORM_KEY,
      fields: current.fields.map((f) => ({ key: f.key, type: f.type, label: f.label, helpText: f.helpText, required: f.required, sensitivity: f.sensitivity })),
    });
    await publishFormDraft(db, pastor, { formKey: JOURNAL_FORM_KEY });

    const identity = await johnIdentity(at('2026-09-17', '07:00'));
    await expect(
      submitJournal(db, identity, req(at('2026-09-17', '07:00')), { idempotencyKey: randomUUID(), formVersionId: versionId, journalDate: '2026-09-17', answers: goodAnswers }),
    ).resolves.toMatchObject({ timing: 'on_time' });

    const later = at('2026-09-17', '19:00');
    const grace = await issuePersonalLink(db, world.admin, { personId: world.ids.grace });
    const { key } = await installPersonalLink(db, req(later, '203.0.113.53'), { token: grace.url.split('/k/')[1]! });
    const graceIdentity = (await resolveParticipantKey(db, key.secret, later))!;
    await expect(
      submitJournal(db, graceIdentity, req(later), { idempotencyKey: randomUUID(), formVersionId: versionId, journalDate: '2026-09-17', answers: goodAnswers }),
    ).rejects.toMatchObject({ code: 'INVALID_STATE', details: { meta: { reason: 'FORM_VERSION_RETIRED' } } });
    versionId = (await getPublishedForm(db, JOURNAL_FORM_KEY))!.versionId;
  });

  it('turns a journal sent through another leader’s QR code into a leader change request', async () => {
    const now = at('2026-09-18', '07:00');
    const identity = await johnIdentity(now);
    const receipt = await submitJournal(db, identity, req(now), {
      idempotencyKey: randomUUID(),
      formVersionId: versionId,
      journalDate: '2026-09-18',
      answers: goodAnswers,
      entryCode: annaCode,
      requestLeaderChange: true,
    });
    expect(receipt.leaderChangeRequested).toBe(true);
    const [request] = await db.select().from(leaderChangeRequests).where(eq(leaderChangeRequests.personId, world.ids.john));
    expect(request).toMatchObject({ status: 'pending', source: 'public_form', toLeaderPersonId: world.ids.anna });
    expect((await resolveEntryCode(db, annaCode))?.leader?.personId).toBe(world.ids.anna);
  });

  it('resolves an open missed-days follow-up when a journal arrives', async () => {
    const now = at('2026-09-19', '07:00');
    await db.insert(careFollowups).values({ personId: world.ids.john, kind: 'journal_missed_streak', summary: 'No journal for 3 days', dedupeKey: 'test-streak' });
    const identity = await johnIdentity(now);
    await submitJournal(db, identity, req(now), { idempotencyKey: randomUUID(), formVersionId: versionId, journalDate: '2026-09-19', answers: goodAnswers });
    const [followUp] = await db.select().from(careFollowups).where(eq(careFollowups.dedupeKey, 'test-streak'));
    expect(followUp).toMatchObject({ status: 'resolved', resolutionNote: 'Journal received' });
  });

  it('records journals from people who are not expected yet (unconfirmed registrations)', async () => {
    const now = at('2026-09-19', '07:30');
    const session = await identifyParticipant(db, req(now, '203.0.113.70'), { phone: '0917 123 0001', firstName: 'Carlo' });
    if (session.result !== 'identified') throw new Error('expected identification');
    const carlo = (await resolveParticipantKey(db, session.key.secret, now))!;
    await submitJournal(db, carlo, req(now), { idempotencyKey: randomUUID(), formVersionId: versionId, journalDate: '2026-09-19', answers: goodAnswers });
    const [dayRow] = await db.select().from(journalDays).where(and(eq(journalDays.personId, carlo.personId), eq(journalDays.journalDate, '2026-09-19')));
    expect(dayRow).toMatchObject({ isExpected: false, submissionStatus: 'submitted', leaderPersonId: world.ids.mark });
    expect(dayRow!.hierarchyPath).toEqual([world.ids.pastor, world.ids.michael, world.ids.mark]);
  });

  it('stops recognising a remembered device once the person is archived', async () => {
    const now = at('2026-09-19', '08:00');
    const link = await issuePersonalLink(db, world.admin, { personId: world.ids.grace });
    const { key } = await installPersonalLink(db, req(now, '203.0.113.71'), { token: link.url.split('/k/')[1]! });
    expect(await resolveParticipantKey(db, key.secret, now)).not.toBeNull();

    await archivePerson(db, world.admin, { personId: world.ids.grace, reason: 'moved' });
    expect(await resolveParticipantKey(db, key.secret, now)).toBeNull();
    expect(await resolveParticipantKey(db, 'x'.repeat(10), now)).toBeNull();
  });
});
