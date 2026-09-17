import { and, eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { RequestContext } from '@/server/context/request-context';
import type { DatabaseHandle } from '@/server/db/client';
import { auditLogs } from '@/server/db/schema';
import { seedReferenceData } from '@/server/db/seed/reference-data';
import { JOBS } from '@/server/modules/scheduler/jobs';
import { runDueJobs } from '@/server/modules/scheduler/scheduler.service';
import { getSystemHealth, runJobSoon } from '@/server/modules/settings/health.service';
import { getSetting, listLeadershipLevels, saveLeadershipLevels, updateSetting } from '@/server/modules/settings/settings.service';
import { createTestDatabase } from '../helpers/db';
import { createUser, globalGrant, userContext } from '../helpers/fixtures';

/** Settings and System health (docs/04 A26, A29; docs/06 rows 10, 20, 35). */

let handle: DatabaseHandle;
let admin: RequestContext;
let pastor: RequestContext;

const unverified = (ctx: RequestContext): RequestContext =>
  ctx.actor.kind === 'user' ? { ...ctx, actor: { ...ctx.actor, twoFactorVerified: false } } : ctx;

beforeAll(async () => {
  handle = await createTestDatabase();
  await seedReferenceData(handle.db);
  const adminUser = await createUser(handle.db);
  const pastorUser = await createUser(handle.db);
  admin = userContext(adminUser, ['settings.view', 'settings.manage', 'journal.settings.manage'].map((p) => globalGrant(p as 'settings.view')));
  pastor = userContext(pastorUser, [globalGrant('settings.view'), globalGrant('journal.settings.manage')]);
});

afterAll(async () => {
  await handle.close();
});

describe('settings', () => {
  it('lets pastors change the journal policy, but only administrators the rest', async () => {
    const policy = await getSetting(handle.db, 'journal.policy');
    await updateSetting(handle.db, pastor, 'journal.policy', { ...policy, missedStreakThreshold: 4 });
    expect((await getSetting(handle.db, 'journal.policy')).missedStreakThreshold).toBe(4);

    const fields = await getSetting(handle.db, 'people.fields');
    await expect(updateSetting(handle.db, pastor, 'people.fields', { ...fields, collectGender: true })).rejects.toMatchObject({ code: 'FORBIDDEN' });
    await updateSetting(handle.db, admin, 'people.fields', { ...fields, collectGender: true });
    expect((await getSetting(handle.db, 'people.fields')).collectGender).toBe(true);

    const [entry] = await handle.db
      .select()
      .from(auditLogs)
      .where(and(eq(auditLogs.action, 'settings.updated'), eq(auditLogs.entityId, 'people.fields')));
    expect(entry?.oldValues).toMatchObject({ collectGender: false });
    expect(entry?.newValues).toMatchObject({ collectGender: true });
  });

  it('needs two-step verification to let more leaders read journal answers, not to narrow it', async () => {
    const policy = await getSetting(handle.db, 'journal.policy');
    await expect(updateSetting(handle.db, unverified(pastor), 'journal.policy', { ...policy, contentVisibilityDepth: 2 })).rejects.toMatchObject({
      code: 'FORBIDDEN',
    });
    await updateSetting(handle.db, pastor, 'journal.policy', { ...policy, contentVisibilityDepth: 2 });
    await updateSetting(handle.db, unverified(pastor), 'journal.policy', { ...policy, contentVisibilityDepth: 1 });
    expect((await getSetting(handle.db, 'journal.policy')).contentVisibilityDepth).toBe(1);
  });

  it('explains invalid values per field and refuses unknown settings', async () => {
    const policy = await getSetting(handle.db, 'journal.policy');
    await expect(updateSetting(handle.db, admin, 'journal.policy', { ...policy, lateCutoffTime: '13:00' })).rejects.toMatchObject({
      code: 'VALIDATION_ERROR',
      details: { fieldErrors: { lateCutoffTime: [expect.any(String)] } },
    });
    await expect(updateSetting(handle.db, admin, 'no.such.setting' as 'privacy', {})).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });

  it('renames leadership levels, adds deeper ones and removes the last', async () => {
    const levels = await listLeadershipLevels(handle.db);
    expect(levels.map((l) => l.name)).toEqual(['Senior Leadership', 'Primary Leader', 'Leader', 'Member']);

    const renamed = levels.map((l) => ({ name: l.name, pluralName: l.pluralName }));
    renamed[3] = { name: 'Disciple', pluralName: 'Disciples' };
    await saveLeadershipLevels(handle.db, admin, { levels: [...renamed, { name: 'New believer', pluralName: 'New believers' }] });
    expect((await listLeadershipLevels(handle.db)).map((l) => l.name)).toEqual(['Senior Leadership', 'Primary Leader', 'Leader', 'Disciple', 'New believer']);

    await saveLeadershipLevels(handle.db, admin, { levels: renamed.slice(0, 3) });
    expect((await listLeadershipLevels(handle.db)).map((l) => l.depth)).toEqual([0, 1, 2]);
    await expect(saveLeadershipLevels(handle.db, pastor, { levels: renamed })).rejects.toMatchObject({ code: 'FORBIDDEN' });
  });
});

describe('system health', () => {
  it('lists every job with its label, and notices when the scheduler has stopped', async () => {
    const now = new Date('2026-09-17T01:00:00Z');
    await runDueJobs(handle.db, JOBS, now);

    const soon = await getSystemHealth(handle.db, { ...admin, now: new Date(now.getTime() + 5 * 60_000) });
    expect(soon.jobs.map((j) => j.key)).toEqual(JOBS.map((j) => j.key));
    expect(soon.jobs.every((j) => j.label.length > 0 && j.lastStatus === 'ok')).toBe(true);
    expect(soon.scheduler.stalled).toBe(false);
    expect(soon.configuration.database).toBe('embedded');
    expect(soon.databaseBytes).toBeGreaterThan(0);

    const later = await getSystemHealth(handle.db, { ...admin, now: new Date(now.getTime() + 60 * 60_000) });
    expect(later.scheduler.stalled).toBe(true);
  });

  it('runs a job at the next tick when asked, for administrators only', async () => {
    const at = new Date('2026-09-17T01:02:00Z');
    const result = await runJobSoon(handle.db, { ...admin, now: at }, { jobKey: 'tokens.cleanup' });
    expect(result.nextRunAt.toISOString()).toBe(at.toISOString());
    const ran = await runDueJobs(handle.db, JOBS, new Date('2026-09-17T01:03:00Z'));
    expect(ran.find((r) => r.key === 'tokens.cleanup')?.status).toBe('ok');

    await expect(runJobSoon(handle.db, admin, { jobKey: 'no.such.job' })).rejects.toMatchObject({ code: 'NOT_FOUND' });
    await expect(getSystemHealth(handle.db, pastor)).rejects.toMatchObject({ code: 'FORBIDDEN' });
  });
});
