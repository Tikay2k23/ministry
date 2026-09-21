import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { RequestContext } from '@/server/context/request-context';
import type { DatabaseHandle } from '@/server/db/client';
import { getPublishedForm, JOURNAL_FORM_KEY } from '@/server/modules/forms/forms.service';
import { zonedInstant } from '@/server/modules/journal/journal-dates';
import { submitJournal } from '@/server/modules/journal/journal-submit.service';
import { installPersonalLink, issuePersonalLink, resolveParticipantKey } from '@/server/modules/public/participants.service';
import { exportJournalReport, getJournalGroupsReport, getJournalPeopleReport } from '@/server/modules/reports/journal-reports.service';
import { getSetting, updateSetting } from '@/server/modules/settings/settings.service';
import { createTestDatabase } from '../helpers/db';
import { globalGrant, userContext } from '../helpers/fixtures';
import { buildWorld } from '../helpers/world';

const at = (date: string, time: string) => zonedInstant(date, time, 'Asia/Manila');
const req = (now: Date) => ({ now, ip: '203.0.113.40', userAgent: 'vitest' });
const atTime = (ctx: RequestContext, now: Date): RequestContext => ({ ...ctx, now });

const REPORT_TIME = at('2026-09-17', '10:00');
const PERIOD = { from: '2026-09-15', to: '2026-09-16' };

let handle: DatabaseHandle;
let db: DatabaseHandle['db'];
let world: Awaited<ReturnType<typeof buildWorld>>;

async function journalAs(personId: string, journalDate: string, now: Date) {
  const link = await issuePersonalLink(db, world.admin, { personId });
  const { key } = await installPersonalLink(db, req(now), { token: link.url.split('/k/')[1]! });
  const identity = (await resolveParticipantKey(db, key.secret, now))!;
  const form = (await getPublishedForm(db, JOURNAL_FORM_KEY))!;
  await submitJournal(db, identity, req(now), {
    idempotencyKey: randomUUID(),
    formVersionId: form.versionId,
    journalDate,
    answers: { reflection: 'God is faithful.', prayed: true },
  });
}

beforeAll(async () => {
  handle = await createTestDatabase();
  db = handle.db;
  world = await buildWorld(db);
  // These tests are about the journal itself, not the photo (tests/integration/journal-proof.test.ts),
  // so the ministry setting is left inviting a photo rather than insisting on one.
  await updateSetting(db, world.admin, 'journal.policy', { ...(await getSetting(db, 'journal.policy')), proofImage: 'optional' });
  // John journals on time on the 15th; Grace sends the 16th late the next morning. Everyone else is quiet.
  await journalAs(world.ids.john, '2026-09-15', at('2026-09-15', '07:00'));
  await journalAs(world.ids.grace, '2026-09-16', at('2026-09-17', '08:00'));

});

afterAll(async () => {
  await handle.close();
});

describe('journal reports', () => {
  it('summarises each person in a leader’s group over a period', async () => {
    const report = await getJournalPeopleReport(db, atTime(world.markCtx, REPORT_TIME), PERIOD);
    expect(report).toMatchObject({ from: '2026-09-15', to: '2026-09-16', view: 'direct', dates: ['2026-09-15', '2026-09-16'] });
    expect(report.rows).toEqual([
      expect.objectContaining({
        personId: world.ids.john,
        leaderName: 'Mark Santos',
        received: 1,
        late: 0,
        missed: 1,
        days: { '2026-09-15': 'submitted', '2026-09-16': 'missed' },
      }),
    ]);
  });

  it('compares groups across the ministry for the office', async () => {
    const report = await getJournalGroupsReport(db, atTime(world.admin, REPORT_TIME), PERIOD);
    expect(report.leader?.id).toBe(world.ids.pastor);
    expect(report.rows.map((r) => [r.name, r.people, r.received, r.late, r.missed])).toEqual([
      ['Michael Reyes', 2, 1, 0, 3],
      ['Samuel Torres', 2, 1, 1, 3],
    ]);
    expect(report.direct).toMatchObject({ people: 2, received: 0, missed: 4 });
    expect(report.branch).toMatchObject({ people: 6, received: 2, late: 1, missed: 10 });
  });

  it('keeps reports within scope and exports only with the export permission', async () => {
    await expect(getJournalPeopleReport(db, atTime(world.markCtx, REPORT_TIME), { ...PERIOD, leaderId: world.ids.anna })).rejects.toMatchObject({
      code: 'NOT_FOUND',
    });
    await expect(getJournalPeopleReport(db, atTime(world.markCtx, REPORT_TIME), { from: '2026-06-01', to: '2026-09-16' })).rejects.toMatchObject({
      code: 'VALIDATION_ERROR',
    });

    const adminUserId = world.admin.actor.kind === 'user' ? world.admin.actor.userId : '';
    const viewOnly = userContext({ id: adminUserId }, [globalGrant('reports.view'), globalGrant('journal.status.view')], REPORT_TIME);
    await expect(exportJournalReport(db, viewOnly, PERIOD, 'people')).rejects.toMatchObject({ code: 'FORBIDDEN' });

    const people = await exportJournalReport(db, atTime(world.markCtx, REPORT_TIME), PERIOD, 'people');
    expect(people.filename).toBe('journal-2026-09-15-to-2026-09-16.csv');
    const lines = people.csv.split('\r\n');
    expect(lines[0]).toBe('﻿Name,Leader,2026-09-15,2026-09-16,Received,Late,No journal,Excused');
    expect(lines[1]).toBe('John Cruz,Mark Santos,Received,No journal,1,0,1,0');

    const groups = await exportJournalReport(db, atTime(world.admin, REPORT_TIME), PERIOD, 'groups');
    expect(groups.csv).toContain('Michael Reyes — branch,2,1,0,3,0');
    expect(groups.csv).toContain('Eduardo Villanueva — whole branch,6,2,1,10,0');
  });
});
