import { and, asc, eq, isNull, lt, or } from 'drizzle-orm';
import { z } from 'zod';
import { newId } from '@/lib/ids';
import type { RequestContext } from '../../context/request-context';
import type { Database, Executor, Transaction } from '../../db/client';
import type { PrayerReportPhotoRule } from '../../db/enums';
import {
  formResponses,
  prayerAssignments,
  prayerChains,
  prayerReportAttachments,
  prayerSlots,
} from '../../db/schema';
import { getEnv } from '../../env';
import { invalidState, notFound, validationError } from '../../errors';
import { logger } from '../../logger';
import { hasGlobal } from '../../policy/can';
import { PENDING_HOURS, processUploadedImage, SIGNED_URL_SECONDS } from '../../storage/images';
import { getStorage, prayerReportPath, type StoredObject } from '../../storage/storage';
import { parseInput } from '../../validation';
import { recordAudit } from '../audit/audit.service';
import type { PublicRequest } from '../public/public-request';
import { assertRateLimit, RATE_LIMITS } from '../public/rate-limit';
import { canAccessChain } from '../../policy/can';

/**
 * The photo someone shares with a prayer report (docs/02 §4 "Prayer report photos").
 *
 * It goes through the same pipeline as a journal's proof photo — decoded to prove what it is,
 * re-encoded so no EXIF survives, kept in a private bucket under a path that names nobody, and
 * only ever shown through a link that stops working after a minute. What differs is who it belongs
 * to and who may look: a prayer report is pastoral, and an anonymous one hides its photo from
 * everyone but the pastoral team, exactly as it hides its words.
 */

export interface UploadedReportPhoto {
  attachmentId: string;
  width: number;
  height: number;
  bytes: number;
}

/**
 * Keeps a photo until the report is sent. The row is `pending`: it belongs to no report yet, and
 * the cleanup job removes it if the person never finishes.
 */
export async function storeReportPhoto(
  db: Database,
  slot: { assignmentId: string; personId: string; chainDate: string; photoRule: PrayerReportPhotoRule },
  req: PublicRequest,
  body: Buffer,
): Promise<UploadedReportPhoto> {
  if (slot.photoRule === 'off') throw invalidState('This prayer chain isn’t collecting photos.');
  await assertRateLimit(
    db,
    `prayer-photo:person:${slot.personId}`,
    RATE_LIMITS.reportPhotoPerPerson,
    req.now,
  );
  if (req.ip) await assertRateLimit(db, `prayer-photo:ip:${req.ip}`, RATE_LIMITS.reportPhotoPerIp, req.now);

  const image = await processUploadedImage(body);
  const id = newId();
  const object: StoredObject = {
    bucket: getEnv().STORAGE_BUCKET,
    path: prayerReportPath(slot.personId, slot.chainDate, id, 'webp'),
  };

  await getStorage().put(object, image.body, image.mimeType);
  try {
    await db.insert(prayerReportAttachments).values({
      id,
      assignmentId: slot.assignmentId,
      personId: slot.personId,
      status: 'pending',
      storageBucket: object.bucket,
      storagePath: object.path,
      mimeType: image.mimeType,
      fileSizeBytes: image.body.byteLength,
      width: image.width,
      height: image.height,
      checksum: image.checksum,
      // The request's clock, not the database's: the day's expiry is measured against it.
      createdAt: req.now,
    });
  } catch (error) {
    // The row is what makes the file findable; without it the file would be orphaned for good.
    await getStorage()
      .remove(object)
      .catch(() => undefined);
    throw error;
  }

  return { attachmentId: id, width: image.width, height: image.height, bytes: image.body.byteLength };
}

/**
 * Ties an uploaded photo to the report being saved, inside the submission's own transaction, so a
 * report is never recorded as complete with its required photo missing.
 */
export async function attachReportPhoto(
  tx: Transaction,
  input: { attachmentId: string; assignmentId: string; personId: string; responseId: string; now: Date },
): Promise<void> {
  const [photo] = await tx
    .select()
    .from(prayerReportAttachments)
    .where(eq(prayerReportAttachments.id, input.attachmentId))
    .for('update');
  // Someone else's photo, one already used, or one from another hour: all the same answer.
  if (
    !photo ||
    photo.personId !== input.personId ||
    photo.assignmentId !== input.assignmentId ||
    photo.status !== 'pending'
  ) {
    throw validationError({ photo: ['That photo is no longer available. Please add it again.'] });
  }
  await tx
    .update(prayerReportAttachments)
    .set({ responseId: input.responseId, status: 'attached', attachedAt: input.now })
    .where(eq(prayerReportAttachments.id, photo.id));
}

export function reportPhotoRequired(rule: PrayerReportPhotoRule): boolean {
  return rule === 'required';
}

/** The chain asked for a photo and none came. */
export function assertReportPhotoPresent(rule: PrayerReportPhotoRule, hasPhoto: boolean): void {
  if (reportPhotoRequired(rule) && !hasPhoto) {
    throw validationError({ photo: ['Please add a photo from your prayer time.'] });
  }
}

// ─── Looking at one ───────────────────────────────────────────────────────────

export const ReportPhotoViewInput = z.object({ attachmentId: z.uuid() });

export interface ReportPhotoView {
  url: string;
  width: number;
  height: number;
  expiresInSeconds: number;
}

/**
 * A short-lived link to one photo, for someone the policy layer allows. The image itself never
 * passes through this service, and the link is never written to the audit log — only the fact that
 * somebody looked (docs/02 §4).
 */
export async function getReportPhotoView(
  db: Database,
  ctx: RequestContext,
  raw: unknown,
): Promise<ReportPhotoView> {
  const { attachmentId } = parseInput(ReportPhotoViewInput, raw);
  const [row] = await db
    .select({
      photo: prayerReportAttachments,
      chainId: prayerChains.id,
      ministryId: prayerChains.ministryId,
      anonymous: formResponses.isAnonymous,
    })
    .from(prayerReportAttachments)
    .innerJoin(prayerAssignments, eq(prayerAssignments.id, prayerReportAttachments.assignmentId))
    .innerJoin(prayerSlots, eq(prayerSlots.id, prayerAssignments.slotId))
    .innerJoin(prayerChains, eq(prayerChains.id, prayerSlots.prayerChainId))
    .leftJoin(formResponses, eq(formResponses.id, prayerReportAttachments.responseId))
    .where(eq(prayerReportAttachments.id, attachmentId));

  if (!row || row.photo.status !== 'attached' || row.photo.deletedFileAt) throw notFound('photo');
  if (
    !canAccessChain(ctx, 'prayer.report.attachment.view', { id: row.chainId, ministryId: row.ministryId })
  ) {
    throw notFound('photo');
  }
  // An anonymous report hides its photo as surely as its words: opened from a named hour, the
  // picture would say who wrote it.
  if (row.anonymous && !hasGlobal(ctx, 'prayer.requests.confidential.view')) throw notFound('photo');

  const object: StoredObject = { bucket: row.photo.storageBucket, path: row.photo.storagePath };
  const url = await getStorage().signedUrl(object, SIGNED_URL_SECONDS);
  await recordAudit(db, ctx, {
    category: 'access',
    action: 'prayer.report_photo_viewed',
    entityType: 'prayer_assignment',
    entityId: row.photo.assignmentId,
    newValues: { attachmentId: row.photo.id },
  });
  return { url, width: row.photo.width, height: row.photo.height, expiresInSeconds: SIGNED_URL_SECONDS };
}

// ─── Housekeeping ─────────────────────────────────────────────────────────────

/**
 * Deletes photos that never became part of a report, and the files of any that were taken off one.
 * Runs hourly (`prayer.report_photo_cleanup`), so an abandoned upload does not sit in the bucket.
 */
export async function cleanupAbandonedReportPhotos(db: Database, now: Date): Promise<{ deleted: number }> {
  const cutoff = new Date(now.getTime() - PENDING_HOURS * 3_600_000);
  const rows = await db
    .select({
      id: prayerReportAttachments.id,
      bucket: prayerReportAttachments.storageBucket,
      path: prayerReportAttachments.storagePath,
    })
    .from(prayerReportAttachments)
    .where(
      and(
        isNull(prayerReportAttachments.deletedFileAt),
        or(
          and(eq(prayerReportAttachments.status, 'pending'), lt(prayerReportAttachments.createdAt, cutoff)),
          eq(prayerReportAttachments.status, 'removed'),
        ),
      ),
    )
    .orderBy(asc(prayerReportAttachments.createdAt))
    .limit(200);

  let deleted = 0;
  for (const row of rows) {
    try {
      await getStorage().remove({ bucket: row.bucket, path: row.path });
    } catch (error) {
      logger.error('Could not delete an unused prayer report photo', error);
      continue;
    }
    // The row stays: the record still shows a photo was there and when it went.
    await db
      .update(prayerReportAttachments)
      .set({ deletedFileAt: now })
      .where(eq(prayerReportAttachments.id, row.id));
    deleted += 1;
  }
  return { deleted };
}

/** The photo already attached to a report, if there is one. */
export async function reportPhotoId(executor: Executor, responseId: string): Promise<string | null> {
  const [row] = await executor
    .select({ id: prayerReportAttachments.id })
    .from(prayerReportAttachments)
    .where(
      and(eq(prayerReportAttachments.responseId, responseId), eq(prayerReportAttachments.status, 'attached')),
    );
  return row?.id ?? null;
}
