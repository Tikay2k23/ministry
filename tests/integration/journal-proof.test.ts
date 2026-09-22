import { randomUUID } from 'node:crypto';
import { and, eq, sql } from 'drizzle-orm';
import sharp from 'sharp';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import type { DatabaseHandle } from '@/server/db/client';
import { journalAttachments, journalEntries } from '@/server/db/schema';
import { getPublishedForm, JOURNAL_FORM_KEY } from '@/server/modules/forms/forms.service';
import { zonedInstant } from '@/server/modules/journal/journal-dates';
import { submitJournal } from '@/server/modules/journal/journal-submit.service';
import {
  cleanupAbandonedProofs,
  getProofView,
  processProofImage,
  removeProof,
  storeProofUpload,
} from '@/server/modules/journal/proof.service';
import { setAcceptsMembers } from '@/server/modules/hierarchy/hierarchy.service';
import { inviteUser } from '@/server/modules/iam/users.service';
import { identifyParticipant, resolveParticipantKey } from '@/server/modules/public/participants.service';
import type { ParticipantIdentity, PublicRequest } from '@/server/modules/public/public-request';
import { getSetting, updateSetting } from '@/server/modules/settings/settings.service';
import { setStorage } from '@/server/storage/storage';
import { createTestDatabase } from '../helpers/db';
import { memoryStorage, type MemoryStorage } from '../helpers/storage';
import { buildWorld, contextFor } from '../helpers/world';

/**
 * Photo proof of a written journal (docs/02 §4). Covers what the bytes are allowed to be, that a
 * required photo really is required, who may look at one afterwards, and that pictures nobody is
 * using are cleared away.
 */

const at = (date: string, time: string) => zonedInstant(date, time, 'Asia/Manila');
const req = (now: Date, ip = '203.0.113.10'): PublicRequest => ({ now, ip, userAgent: 'Mozilla/5.0 (Linux; Android 14) Chrome/120 Mobile' });
const answers = { reflection: 'God is faithful.', prayed: true, scripture: 'Psalm 23' };

let handle: DatabaseHandle;
let db: DatabaseHandle['db'];
let world: Awaited<ReturnType<typeof buildWorld>>;
let storage: MemoryStorage;
let versionId: string;
let johnPhone: string;

/** A real image of the given format, the way a phone would send one. */
async function photo(format: 'jpeg' | 'png' | 'webp', width = 1200, height = 1600): Promise<Buffer> {
  const canvas = sharp({ create: { width, height, channels: 3, background: { r: 240, g: 240, b: 230 } } });
  if (format === 'jpeg') return canvas.jpeg().toBuffer();
  if (format === 'png') return canvas.png().toBuffer();
  return canvas.webp().toBuffer();
}

/** Identifying is rate limited per address, so the fixture does it once and every test reuses it. */
let john: ParticipantIdentity;
let pastorCtx: Awaited<ReturnType<typeof contextFor>>;
async function identity(_now: Date): Promise<ParticipantIdentity> {
  return john;
}

async function upload(now: Date, who: ParticipantIdentity, body?: Buffer) {
  return storeProofUpload(db, who, req(now), { body: body ?? (await photo('jpeg')), journalDate: '2026-09-15' });
}

beforeAll(async () => {
  handle = await createTestDatabase();
  db = handle.db;
  world = await buildWorld(db);
  await setAcceptsMembers(db, world.admin, { personId: world.ids.mark, acceptsMembers: true });
  versionId = (await getPublishedForm(db, JOURNAL_FORM_KEY))!.versionId;
  johnPhone = '0917 555 0143';
  // John is Mark's; he needs a phone number to identify with.
  await db.execute(sql`UPDATE people SET phone_e164 = '+639175550143' WHERE id = ${world.ids.john}::uuid`);
  const now = at('2026-09-15', '06:00');
  const identified = await identifyParticipant(db, req(now), { phone: johnPhone, firstName: 'John', rememberDevice: true });
  if (identified.result !== 'identified') throw new Error(`The fixture person could not identify: ${identified.result}`);
  // The real flow reads the device cookie back; the tests do the same rather than fake an identity.
  const { userId } = await inviteUser(db, world.admin, { personId: world.ids.pastor, email: 'pastor@gentouch.test', roleKey: 'pastor' });
  pastorCtx = await contextFor(db, userId);
  const resolved = await resolveParticipantKey(db, identified.key.secret, now);
  if (!resolved) throw new Error('The device key did not resolve.');
  john = resolved;
});

afterAll(async () => {
  await handle.close();
});

afterEach(() => {
  setStorage(undefined);
});

function useMemoryStorage() {
  storage = memoryStorage();
  setStorage(storage);
  return storage;
}

describe('what a proof photo may be', () => {
  it('accepts JPEG, PNG and WebP, and stores every one as WebP', async () => {
    for (const format of ['jpeg', 'png', 'webp'] as const) {
      const processed = await processProofImage(await photo(format));
      expect(processed.mimeType).toBe('image/webp');
      expect(processed.width).toBeGreaterThan(0);
      expect(processed.checksum).toMatch(/^[0-9a-f]{64}$/);
    }
  });

  it('refuses a file larger than 5 MB with a plain message', async () => {
    const tooBig = Buffer.alloc(5 * 1024 * 1024 + 1, 1);
    await expect(processProofImage(tooBig)).rejects.toMatchObject({
      code: 'VALIDATION_ERROR',
      details: { fieldErrors: { file: ['Please choose an image smaller than 5 MB.'] } },
    });
  });

  it('refuses anything that is not one of those three, whatever it is called', async () => {
    const files = {
      pdf: Buffer.from('%PDF-1.7\n1 0 obj<</Type/Catalog>>endobj\n'),
      svg: Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>'),
      html: Buffer.from('<!doctype html><script>alert(1)</script>'),
      // A Windows executable renamed journal-photo.jpg: the name means nothing, the bytes decide.
      executable: Buffer.concat([Buffer.from('MZ'), Buffer.alloc(2048, 0x90)]),
      gif: await sharp({ create: { width: 10, height: 10, channels: 3, background: '#fff' } }).gif().toBuffer(),
    };
    for (const [name, body] of Object.entries(files)) {
      await expect(processProofImage(body), name).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
    }
  });

  it('shrinks a big photo and turns a sideways one the right way up', async () => {
    // A 4000×3000 photo the camera marked "rotate 90°", as a phone held upright produces.
    const rotated = await sharp({ create: { width: 4000, height: 3000, channels: 3, background: '#eee' } })
      .withMetadata({ orientation: 6 })
      .jpeg()
      .toBuffer();

    const processed = await processProofImage(rotated);
    expect(Math.max(processed.width, processed.height)).toBeLessThanOrEqual(2000);
    // Orientation 6 means the stored image is portrait once it has been applied.
    expect(processed.height).toBeGreaterThan(processed.width);
  });

  it('keeps no EXIF, so the ministry never holds where someone was standing', async () => {
    const withGps = await sharp({ create: { width: 800, height: 600, channels: 3, background: '#eee' } })
            // IFD3 is where the GPS block lives, which is exactly what must not survive.
      .withExif({ IFD0: { Copyright: 'GenTouch', Make: 'TestPhone' }, IFD3: { GPSLatitudeRef: 'N', GPSLatitude: '14/1 35/1 0/1' } })
      .jpeg()
      .toBuffer();
    expect((await sharp(withGps).metadata()).exif).toBeDefined();

    const processed = await processProofImage(withGps);
    expect((await sharp(processed.body).metadata()).exif).toBeUndefined();
  });
});

describe('sending a journal with its photo', () => {
  it('keeps the photo out of the journal until the journal is sent, and stores it under a name that says nothing', async () => {
    useMemoryStorage();
    const now = at('2026-09-15', '20:10');
    const who = await identity(now);
    const uploaded = await upload(now, who);

    const [row] = await db.select().from(journalAttachments).where(eq(journalAttachments.id, uploaded.attachmentId));
    expect(row).toMatchObject({ status: 'pending', entryId: null, mimeType: 'image/webp', personId: world.ids.john });
    expect(storage.objects.size).toBe(1);

    // Nothing in the path identifies the person to anyone who sees it.
    expect(row!.storagePath).toMatch(/^[0-9a-f-]{36}\/2026-09-15\/[0-9a-f-]{36}\.webp$/);
    expect(row!.storagePath).not.toContain('John');
    for (const written of ['+639175550143', '639175550143', '09175550143', '9175550143']) {
      expect(row!.storagePath).not.toContain(written);
    }

    await submitJournal(db, who, req(now), { idempotencyKey: randomUUID(), formVersionId: versionId, journalDate: '2026-09-15', answers, attachmentId: uploaded.attachmentId });

    const [attached] = await db.select().from(journalAttachments).where(eq(journalAttachments.id, uploaded.attachmentId));
    expect(attached).toMatchObject({ status: 'attached' });
    expect(attached!.entryId).not.toBeNull();
    expect(attached!.attachedAt).not.toBeNull();
  });

  it('refuses the journal when the ministry requires a photo and none was sent', async () => {
    useMemoryStorage();
    const now = at('2026-09-16', '20:10');
    const who = await identity(now);

    await expect(
      submitJournal(db, who, req(now), { idempotencyKey: randomUUID(), formVersionId: versionId, journalDate: '2026-09-16', answers }),
    ).rejects.toMatchObject({ code: 'VALIDATION_ERROR', details: { fieldErrors: { proof: ['A photo of your written journal is needed.'] } } });

    // Nothing was written for that day: the refusal happens before the journal is saved.
    const saved = await db.select().from(journalEntries).where(and(eq(journalEntries.personId, world.ids.john), eq(journalEntries.journalDate, '2026-09-16')));
    expect(saved).toHaveLength(0);
  });

  it('accepts a journal without a photo when the ministry only invites one', async () => {
    useMemoryStorage();
    await updateSetting(db, world.admin, 'journal.policy', { ...(await getSetting(db, 'journal.policy')), proofImage: 'optional' });

    const now = at('2026-09-17', '20:10');
    const who = await identity(now);
    const receipt = await submitJournal(db, who, req(now), { idempotencyKey: randomUUID(), formVersionId: versionId, journalDate: '2026-09-17', answers });
    expect(receipt.journalDate).toBe('2026-09-17');

    await updateSetting(db, world.admin, 'journal.policy', { ...(await getSetting(db, 'journal.policy')), proofImage: 'required' });
  });

  it('does not attach the same photo twice when a submission is replayed', async () => {
    useMemoryStorage();
    const now = at('2026-09-18', '20:10');
    const who = await identity(now);
    const uploaded = await upload(now, who);
    const key = randomUUID();
    const body = { idempotencyKey: key, formVersionId: versionId, journalDate: '2026-09-18', answers, attachmentId: uploaded.attachmentId };

    const first = await submitJournal(db, who, req(now), body);
    const replay = await submitJournal(db, who, req(new Date(now.getTime() + 1000)), body);
    expect(replay.receivedAt.getTime()).toBe(first.receivedAt.getTime());

    const rows = await db
      .select()
      .from(journalAttachments)
      .where(and(eq(journalAttachments.id, uploaded.attachmentId), eq(journalAttachments.status, 'attached')));
    expect(rows).toHaveLength(1);
  });

  it("refuses a photo that belongs to somebody else's journal", async () => {
    useMemoryStorage();
    const now = at('2026-09-19', '20:10');
    const who = await identity(now);
    const uploaded = await upload(now, who);

    // Grace tries to send John's photo as her own.
    const grace: ParticipantIdentity = { keyId: randomUUID(), personId: world.ids.grace, persistent: true, channel: 'phone_match' };
    await expect(
      submitJournal(db, grace, req(now), { idempotencyKey: randomUUID(), formVersionId: versionId, journalDate: '2026-09-19', answers, attachmentId: uploaded.attachmentId }),
    ).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
  });
});

describe('who may look at a photo', () => {
  it('gives a short-lived link to the leader who may see it, and records the look', async () => {
    useMemoryStorage();
    const now = at('2026-09-20', '20:10');
    const who = await identity(now);
    const uploaded = await upload(now, who);
    await submitJournal(db, who, req(now), { idempotencyKey: randomUUID(), formVersionId: versionId, journalDate: '2026-09-20', answers, attachmentId: uploaded.attachmentId });

    const view = await getProofView(db, world.markCtx, { attachmentId: uploaded.attachmentId });
    expect(view.url).toContain('https://storage.test/');
    expect(view.expiresInSeconds).toBeLessThanOrEqual(60);
    expect(storage.lastSignedSeconds).toBe(60);
  });

  it('tells a leader from another branch nothing at all', async () => {
    useMemoryStorage();
    const now = at('2026-09-21', '20:10');
    const who = await identity(now);
    const uploaded = await upload(now, who);
    await submitJournal(db, who, req(now), { idempotencyKey: randomUUID(), formVersionId: versionId, journalDate: '2026-09-21', answers, attachmentId: uploaded.attachmentId });

    // Anna leads the other branch: the same answer as an id that does not exist.
    await expect(getProofView(db, world.annaCtx, { attachmentId: uploaded.attachmentId })).rejects.toMatchObject({ code: 'NOT_FOUND' });
    await expect(getProofView(db, world.markCtx, { attachmentId: randomUUID() })).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });

  it('refuses a photo that is still waiting for its journal', async () => {
    useMemoryStorage();
    const now = at('2026-09-22', '20:10');
    const who = await identity(now);
    const uploaded = await upload(now, who);
    await expect(getProofView(db, world.markCtx, { attachmentId: uploaded.attachmentId })).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });
});

describe('clearing up', () => {
  it('deletes photos whose journal never arrived, after a day, and keeps the ones in use', async () => {
    useMemoryStorage();
    const now = at('2026-09-23', '20:10');
    const who = await identity(now);
    const abandoned = await upload(now, who);
    const kept = await upload(now, who, await photo('png'));
    await submitJournal(db, who, req(now), { idempotencyKey: randomUUID(), formVersionId: versionId, journalDate: '2026-09-23', answers, attachmentId: kept.attachmentId });
    expect(storage.objects.size).toBe(2);

    const fileOf = async (id: string) => {
      const [row] = await db.select().from(journalAttachments).where(eq(journalAttachments.id, id));
      return row!;
    };

    // An hour later this pair is far too new to touch.
    await cleanupAbandonedProofs(db, new Date(now.getTime() + 3_600_000));
    expect((await fileOf(abandoned.attachmentId)).deletedFileAt).toBeNull();
    expect(storage.objects.size).toBe(2);

    const laterStill = new Date(now.getTime() + 25 * 3_600_000);
    await cleanupAbandonedProofs(db, laterStill);

    const gone = await fileOf(abandoned.attachmentId);
    expect(gone.deletedFileAt).not.toBeNull();
    expect(storage.objects.has(`${gone.storageBucket}/${gone.storagePath}`)).toBe(false);

    // The one that belongs to a journal is untouched: a proof is kept as long as its journal is.
    const survivor = await fileOf(kept.attachmentId);
    expect(survivor.status).toBe('attached');
    expect(survivor.deletedFileAt).toBeNull();
    expect(storage.objects.has(`${survivor.storageBucket}/${survivor.storagePath}`)).toBe(true);

    // Running it again changes nothing: already-deleted files are not looked at twice.
    expect(await cleanupAbandonedProofs(db, laterStill)).toEqual({ deleted: 0 });
  });

  it('lets an administrator take a photo off a journal, and deletes the picture', async () => {
    useMemoryStorage();
    const now = at('2026-09-24', '20:10');
    const who = await identity(now);
    const uploaded = await upload(now, who);
    await submitJournal(db, who, req(now), { idempotencyKey: randomUUID(), formVersionId: versionId, journalDate: '2026-09-24', answers, attachmentId: uploaded.attachmentId });

    // A leader may see a photo but not remove one, and the Super Admin holds no pastoral
    // content at all (docs/README decision 5), so this is a pastor's to do.
    await expect(removeProof(db, world.markCtx, { attachmentId: uploaded.attachmentId })).rejects.toMatchObject({ code: 'NOT_FOUND' });
    await expect(removeProof(db, world.admin, { attachmentId: uploaded.attachmentId })).rejects.toMatchObject({ code: 'NOT_FOUND' });

    await removeProof(db, pastorCtx, { attachmentId: uploaded.attachmentId });
    const [row] = await db.select().from(journalAttachments).where(eq(journalAttachments.id, uploaded.attachmentId));
    expect(row?.status).toBe('removed');
    expect(storage.objects.has(`${row!.storageBucket}/${row!.storagePath}`)).toBe(false);
    await expect(getProofView(db, world.markCtx, { attachmentId: uploaded.attachmentId })).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });
});
