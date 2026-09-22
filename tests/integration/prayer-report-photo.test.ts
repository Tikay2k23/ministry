import { eq } from 'drizzle-orm';
import sharp from 'sharp';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { RequestContext } from '@/server/context/request-context';
import type { DatabaseHandle } from '@/server/db/client';
import { auditLogs, prayerReportAttachments } from '@/server/db/schema';
import { zonedInstant } from '@/server/modules/journal/journal-dates';
import { assignToSlot } from '@/server/modules/prayer/assignments.service';
import { createChain, setChainStatus, updateChain } from '@/server/modules/prayer/chains.service';
import {
  respondFromChainPage,
  submitReportFromChainPage,
  uploadReportPhotoFromChainPage,
} from '@/server/modules/prayer/participation.service';
import {
  cleanupAbandonedReportPhotos,
  getReportPhotoView,
} from '@/server/modules/prayer/report-photo.service';
import { prayerSlots } from '@/server/db/schema';
import { and } from 'drizzle-orm';
import { issueParticipantKey, resolveParticipantKey } from '@/server/modules/public/participants.service';
import type { ParticipantIdentity, PublicRequest } from '@/server/modules/public/public-request';
import type { PermissionKey } from '@/server/policy/catalog';
import { setStorage } from '@/server/storage/storage';
import { createTestDatabase } from '../helpers/db';
import { globalGrant, userContext } from '../helpers/fixtures';
import { memoryStorage, type MemoryStorage } from '../helpers/storage';
import { buildWorld } from '../helpers/world';

/**
 * The photo someone shares with a prayer report (docs/02 §4). Covers what the bytes are allowed to
 * be, that a required photo really is required, who may look at one afterwards — including that an
 * anonymous report hides its picture as surely as its words — and that photos nobody used are
 * cleared away.
 */

const TZ = 'Asia/Manila';
const at = (date: string, time: string) => zonedInstant(date, time, TZ);
const req = (now: Date, ip = '203.0.113.40'): PublicRequest => ({
  now,
  ip,
  userAgent: 'Mozilla/5.0 (Linux; Android 14) Chrome/120 Mobile',
});

/** A real image of the given format, the way a phone would send one. */
async function photo(format: 'jpeg' | 'png' | 'webp' = 'jpeg', width = 1200, height = 1600): Promise<Buffer> {
  const canvas = sharp({ create: { width, height, channels: 3, background: { r: 240, g: 240, b: 230 } } });
  if (format === 'png') return canvas.png().toBuffer();
  if (format === 'webp') return canvas.webp().toBuffer();
  return canvas.jpeg().toBuffer();
}

let handle: DatabaseHandle;
let db: DatabaseHandle['db'];
let world: Awaited<ReturnType<typeof buildWorld>>;
let storage: MemoryStorage;
let adminUserId: string;
let chainId: string;
let grace: ParticipantIdentity;
let assignmentId: string;

const COORDINATOR: PermissionKey[] = [
  'prayer.view',
  'prayer.manage',
  'prayer.assign',
  'prayer.resolve',
  'prayer.reports.view',
  'people.view',
];
const office = (now: Date): RequestContext =>
  userContext({ id: adminUserId }, COORDINATOR.map(globalGrant), now);
/** The pastoral team: the words, the confidential answers and the picture. */
const pastor = (now: Date): RequestContext =>
  userContext(
    { id: adminUserId },
    (
      [
        'prayer.view',
        'prayer.reports.view',
        'prayer.report.attachment.view',
        'prayer.requests.confidential.view',
      ] as PermissionKey[]
    ).map(globalGrant),
    now,
  );

const chainSettings = {
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
  reportPhoto: 'optional' as const,
};

const failure = (promise: Promise<unknown>) =>
  promise.then(
    () => null,
    (error: { code?: string; message?: string; details?: { fieldErrors?: Record<string, string[]> } }) => ({
      code: error.code,
      message: error.message,
      fieldErrors: error.details?.fieldErrors,
    }),
  );

/** Puts someone on an hour, identifies their phone, and finishes the hour: ready to report. */
async function prayedAt(
  personId: string,
  date: string,
  time: string,
): Promise<{ who: ParticipantIdentity; assignmentId: string }> {
  const now = at(date, time);
  const [slot] = await db
    .select()
    .from(prayerSlots)
    .where(and(eq(prayerSlots.prayerChainId, chainId), eq(prayerSlots.startsAt, now)));
  if (!slot) throw new Error(`No slot at ${date} ${time}`);
  const { assignmentId: id } = await assignToSlot(db, office(at('2026-09-19', '10:00')), {
    slotId: slot.id,
    personId,
  });
  const key = await issueParticipantKey(db, {
    personId,
    createdVia: 'phone_match',
    persistent: true,
    now,
    userAgent: null,
  });
  const who = (await resolveParticipantKey(db, key.secret, now))!;
  await respondFromChainPage(db, who, req(new Date(now.getTime() + 30 * 60_000)), {
    assignmentId: id,
    action: 'complete',
  });
  return { who, assignmentId: id };
}

beforeAll(async () => {
  handle = await createTestDatabase();
  db = handle.db;
  storage = memoryStorage();
  setStorage(storage);
  world = await buildWorld(db);
  adminUserId = world.admin.actor.kind === 'user' ? world.admin.actor.userId : '';

  const created = await createChain(db, office(at('2026-09-19', '10:00')), {
    ...chainSettings,
    schedule: {
      rrule: 'FREQ=DAILY',
      firstSlotTime: '00:00',
      slotMinutes: 60,
      slotsPerOccurrence: 24,
      capacity: 1,
      effectiveFrom: '2026-09-20',
      generateDaysAhead: 2,
    },
  });
  chainId = created.chainId;
  await setChainStatus(db, office(at('2026-09-19', '10:00')), { chainId, status: 'active' });

  ({ who: grace, assignmentId } = await prayedAt(world.ids.grace, '2026-09-20', '02:00'));
});

afterAll(async () => {
  await handle.close();
});

describe('a photo with a prayer report', () => {
  it('keeps the photo out of the report until the report is sent, under a name that says nothing', async () => {
    const now = at('2026-09-20', '02:35');
    const uploaded = await uploadReportPhotoFromChainPage(
      db,
      grace,
      req(now),
      { assignmentId },
      await photo('jpeg'),
    );

    const [row] = await db
      .select()
      .from(prayerReportAttachments)
      .where(eq(prayerReportAttachments.id, uploaded.attachmentId));
    expect(row).toMatchObject({
      status: 'pending',
      responseId: null,
      mimeType: 'image/webp',
      personId: world.ids.grace,
      assignmentId,
    });
    expect(storage.objects.size).toBe(1);

    // Nothing in the path identifies the person to anyone who sees it.
    expect(row!.storagePath).toMatch(/^prayer-report\/[0-9a-f-]{36}\/2026-09-20\/[0-9a-f-]{36}\.webp$/);
    expect(row!.storagePath).not.toContain('Grace');

    await submitReportFromChainPage(db, grace, req(at('2026-09-20', '02:40')), {
      assignmentId,
      answers: { testimony: 'The Lord met me in the quiet.' },
      attachmentId: uploaded.attachmentId,
    });
    const [attached] = await db
      .select()
      .from(prayerReportAttachments)
      .where(eq(prayerReportAttachments.id, uploaded.attachmentId));
    expect(attached).toMatchObject({ status: 'attached' });
    expect(attached!.responseId).not.toBeNull();
    expect(attached!.attachedAt).not.toBeNull();
  });

  it('refuses anything that is not a photo, however it is named, and anything too big', async () => {
    const now = at('2026-09-20', '06:45');
    const mark = await prayedAt(world.ids.mark, '2026-09-20', '06:00');
    const send = (body: Buffer) =>
      uploadReportPhotoFromChainPage(db, mark.who, req(now), { assignmentId: mark.assignmentId }, body);

    // An SVG, a PDF and a renamed executable all fail the same way: they do not decode.
    for (const pretender of [
      '<svg xmlns="http://www.w3.org/2000/svg"><rect width="9" height="9"/></svg>',
      '%PDF-1.7\n%âãÏÓ',
      'MZ\x90\x00\x03',
    ]) {
      expect(await failure(send(Buffer.from(pretender)))).toMatchObject({ code: 'VALIDATION_ERROR' });
    }
    expect(await failure(send(Buffer.alloc(6 * 1024 * 1024, 1)))).toMatchObject({
      fieldErrors: { file: expect.any(Array) },
    });
  });

  it('shows the photo only to someone the ministry allows, through a link that expires', async () => {
    const now = at('2026-09-20', '09:00');
    const [attached] = await db
      .select()
      .from(prayerReportAttachments)
      .where(eq(prayerReportAttachments.status, 'attached'));

    // A coordinator reads the report but is not given the picture (docs/06 note n).
    expect(await failure(getReportPhotoView(db, office(now), { attachmentId: attached!.id }))).toMatchObject({
      code: 'NOT_FOUND',
    });

    const view = await getReportPhotoView(db, pastor(now), { attachmentId: attached!.id });
    expect(view.url).toContain(attached!.storagePath);
    expect(storage.lastSignedSeconds).toBe(60);
    // The link itself is never written down; only that somebody looked.
    const [logged] = await db
      .select()
      .from(auditLogs)
      .where(eq(auditLogs.action, 'prayer.report_photo_viewed'));
    expect(logged?.newValues).toMatchObject({ attachmentId: attached!.id });
    expect(JSON.stringify(logged?.newValues)).not.toContain('signed');
  });

  it('hides an anonymous report’s photo from everyone but the pastoral team', async () => {
    const now = at('2026-09-20', '04:40');
    const { who: her, assignmentId: annas } = await prayedAt(world.ids.anna, '2026-09-20', '04:00');

    const uploaded = await uploadReportPhotoFromChainPage(
      db,
      her,
      req(now),
      { assignmentId: annas },
      await photo('webp'),
    );
    await submitReportFromChainPage(db, her, req(now), {
      assignmentId: annas,
      answers: { testimony: 'Shared without my name.' },
      anonymous: true,
      attachmentId: uploaded.attachmentId,
    });

    // Opened from a named hour, the picture would say who wrote it.
    const withPhotos = userContext(
      { id: adminUserId },
      (['prayer.view', 'prayer.reports.view', 'prayer.report.attachment.view'] as PermissionKey[]).map(
        globalGrant,
      ),
      now,
    );
    expect(
      await failure(getReportPhotoView(db, withPhotos, { attachmentId: uploaded.attachmentId })),
    ).toMatchObject({ code: 'NOT_FOUND' });
    expect(
      (await getReportPhotoView(db, pastor(now), { attachmentId: uploaded.attachmentId })).width,
    ).toBeGreaterThan(0);
  });

  it('clears away a photo nobody used', async () => {
    const { who: him, assignmentId: johns } = await prayedAt(world.ids.john, '2026-09-21', '05:00');
    const abandoned = await uploadReportPhotoFromChainPage(
      db,
      him,
      req(at('2026-09-21', '05:35')),
      { assignmentId: johns },
      await photo(),
    );

    const before = storage.objects.size;
    expect(await cleanupAbandonedReportPhotos(db, at('2026-09-21', '06:00'))).toEqual({ deleted: 0 }); // still within the day
    expect(await cleanupAbandonedReportPhotos(db, at('2026-09-22', '09:00'))).toEqual({ deleted: 1 });
    expect(storage.objects.size).toBe(before - 1);

    // The row stays, so the record still shows a photo was there and when it went.
    const [row] = await db
      .select()
      .from(prayerReportAttachments)
      .where(eq(prayerReportAttachments.id, abandoned.attachmentId));
    expect(row).toMatchObject({ status: 'pending' });
    expect(row!.deletedFileAt).not.toBeNull();
  });

  it('asks for a photo only when the chain does, and refuses a report without one when it does', async () => {
    const now = at('2026-09-20', '03:40');
    // Michael prays an hour in a chain that now insists on a photo.
    const { who: him, assignmentId: michael } = await prayedAt(world.ids.michael, '2026-09-20', '03:00');

    await updateChain(db, office(now), { ...chainSettings, chainId, reportPhoto: 'required' });
    expect(
      await failure(
        submitReportFromChainPage(db, him, req(now), {
          assignmentId: michael,
          answers: { testimony: 'He is faithful.' },
        }),
      ),
    ).toMatchObject({
      fieldErrors: { photo: expect.any(Array) },
    });

    const uploaded = await uploadReportPhotoFromChainPage(
      db,
      him,
      req(now),
      { assignmentId: michael },
      await photo('png'),
    );
    expect(
      await submitReportFromChainPage(db, him, req(now), {
        assignmentId: michael,
        answers: {},
        attachmentId: uploaded.attachmentId,
      }),
    ).toEqual({
      received: true,
    });

    // Off again: the chain stops asking, and stops accepting.
    const samuel = await prayedAt(world.ids.samuel, '2026-09-20', '07:00');
    await updateChain(db, office(now), { ...chainSettings, chainId, reportPhoto: 'off' });
    expect(
      await failure(
        uploadReportPhotoFromChainPage(
          db,
          samuel.who,
          req(at('2026-09-20', '07:40')),
          { assignmentId: samuel.assignmentId },
          await photo(),
        ),
      ),
    ).toMatchObject({ code: 'INVALID_STATE' });
  });
});
