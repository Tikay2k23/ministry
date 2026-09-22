import { and, asc, eq, inArray, isNull, lt, or } from 'drizzle-orm';
import { z } from 'zod';
import { newId } from '@/lib/ids';
import type { Database, Executor, Transaction } from '../../db/client';
import { journalAttachments, journalEntries } from '../../db/schema';
import type { RequestContext } from '../../context/request-context';
import { getEnv } from '../../env';
import { invalidState, notFound, validationError } from '../../errors';
import { logger } from '../../logger';
import { assertCanAccessPerson } from '../../policy/can';
import { parseInput } from '../../validation';
import {
  MAX_UPLOAD_BYTES,
  PENDING_HOURS,
  processUploadedImage,
  SIGNED_URL_SECONDS,
  type ProcessedImage,
} from '../../storage/images';
import { getStorage, proofPath, type StoredObject } from '../../storage/storage';
import { recordAudit } from '../audit/audit.service';
import type { ParticipantIdentity, PublicRequest } from '../public/public-request';
import { assertRateLimit, RATE_LIMITS } from '../public/rate-limit';
import { getSetting } from '../settings/settings.service';
import { openJournalDates } from './journal-dates';

/**
 * Photo proof of a written journal (docs/02 §4 "Journal proof", docs/02a §2).
 *
 * A member photographs the notebook they wrote in and sends it with their journal. The picture is
 * private ministry data: it is kept in a private bucket under a name the server chooses, and is
 * only ever shown through a link that stops working after a minute, to someone the policy layer
 * has allowed.
 *
 * The bytes are never trusted. Every upload is decoded here — which is what tells us it really is
 * a JPEG, PNG or WebP, whatever the filename or the browser claimed — then resized and re-encoded
 * as WebP, which also drops the EXIF block, so the ministry does not end up holding the GPS
 * coordinates of everybody's bedroom.
 */

export { MAX_UPLOAD_BYTES, PENDING_HOURS, processUploadedImage as processProofImage, SIGNED_URL_SECONDS };
export type { ProcessedImage };

export interface UploadedProof {
  attachmentId: string;
  width: number;
  height: number;
  bytes: number;
}

/**
 * Takes a photo from the public journal page and keeps it until the journal is sent. The row is
 * `pending`: it belongs to nobody's journal yet, and the cleanup job removes it if the member
 * never finishes.
 */
export async function storeProofUpload(
  db: Database,
  identity: ParticipantIdentity,
  req: PublicRequest,
  input: { body: Buffer; journalDate?: string },
): Promise<UploadedProof> {
  await assertRateLimit(db, `journal-proof:person:${identity.personId}`, RATE_LIMITS.proofUploadPerPerson, req.now);
  if (req.ip) await assertRateLimit(db, `journal-proof:ip:${req.ip}`, RATE_LIMITS.proofUploadPerIp, req.now);

  const [{ timezone }, policy] = await Promise.all([getSetting(db, 'ministry.profile'), getSetting(db, 'journal.policy')]);
  if (policy.proofImage === 'off') throw invalidState('Journal photos aren’t being collected at the moment.');

  // The date only organises the files. It still has to be a day this person could be sending.
  const { today, yesterday } = openJournalDates(req.now, timezone, policy);
  const journalDate = input.journalDate === yesterday ? yesterday : today;

  const image = await processUploadedImage(input.body);
  const id = newId();
  const object: StoredObject = { bucket: getEnv().STORAGE_BUCKET, path: proofPath(identity.personId, journalDate, id, 'webp') };

  await getStorage().put(object, image.body, image.mimeType);
  try {
    await db.insert(journalAttachments).values({
      id,
      personId: identity.personId,
      kind: 'proof',
      status: 'pending',
      storageBucket: object.bucket,
      storagePath: object.path,
      mimeType: image.mimeType,
      fileSizeBytes: image.body.byteLength,
      width: image.width,
      height: image.height,
      checksum: image.checksum,
      uploadedVia: identity.channel,
      // The request's clock, not the database's: everything else in the journal is dated this way,
      // and the day's expiry is measured against it.
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
 * Ties an uploaded photo to the journal being saved, inside the submission's own transaction, so a
 * journal is never recorded as complete with its required proof missing.
 *
 * Returns the files that are no longer part of a journal (a replaced proof when a member edits),
 * for the caller to delete once the transaction has committed — storage cannot take part in it.
 */
export async function attachProof(
  tx: Transaction,
  input: { attachmentId: string; personId: string; entryId: string; now: Date },
): Promise<StoredObject[]> {
  const [attachment] = await tx
    .select()
    .from(journalAttachments)
    .where(and(eq(journalAttachments.id, input.attachmentId), eq(journalAttachments.personId, input.personId)))
    .for('update');

  if (!attachment || attachment.status === 'removed') {
    throw validationError({ proof: ['That photo is no longer available. Please add it again.'] });
  }
  // Already attached to this journal: sending the same submission twice must not change anything.
  if (attachment.status === 'attached' && attachment.entryId === input.entryId) return [];
  if (attachment.status === 'attached') {
    throw validationError({ proof: ['That photo already belongs to another journal. Please add it again.'] });
  }
  if (input.now.getTime() - attachment.createdAt.getTime() > PENDING_HOURS * 3_600_000) {
    throw validationError({ proof: ['That photo has expired. Please add it again.'] });
  }

  // Replacing an earlier proof for the same journal (an edit): keep the row for the record, drop
  // the picture.
  const superseded = await tx
    .update(journalAttachments)
    .set({ status: 'removed', removedAt: input.now })
    .where(and(eq(journalAttachments.entryId, input.entryId), eq(journalAttachments.kind, 'proof'), eq(journalAttachments.status, 'attached')))
    .returning({ bucket: journalAttachments.storageBucket, path: journalAttachments.storagePath });

  await tx
    .update(journalAttachments)
    .set({ entryId: input.entryId, status: 'attached', attachedAt: input.now })
    .where(eq(journalAttachments.id, input.attachmentId));

  return superseded;
}

/** Whether this journal already carries its proof (an edit that doesn't send a new photo). */
export async function entryHasProof(executor: Executor, entryId: string): Promise<boolean> {
  const [row] = await executor
    .select({ id: journalAttachments.id })
    .from(journalAttachments)
    .where(and(eq(journalAttachments.entryId, entryId), eq(journalAttachments.kind, 'proof'), eq(journalAttachments.status, 'attached')));
  return Boolean(row);
}

/** Deletes files that are no longer referenced. Never throws: the journal is already saved. */
export async function discardObjects(objects: StoredObject[]): Promise<void> {
  for (const object of objects) {
    await getStorage()
      .remove(object)
      .catch((error: unknown) => logger.error('Could not delete a superseded journal proof', error));
  }
}

export const ProofViewInput = z.object({ attachmentId: z.uuid() });

export interface ProofView {
  url: string;
  width: number;
  height: number;
  expiresInSeconds: number;
}

/**
 * A link to one photo, for a leader or pastor who may see it. Being further up the leadership tree
 * is not enough on its own: `journal.proof.view` is a separate permission from reading the answers
 * (docs/06 row 21a), and the same branch scoping applies. Every look is recorded.
 */
export async function getProofView(db: Database, ctx: RequestContext, raw: unknown): Promise<ProofView> {
  const { attachmentId } = parseInput(ProofViewInput, raw);
  const [attachment] = await db
    .select({
      id: journalAttachments.id,
      personId: journalAttachments.personId,
      entryId: journalAttachments.entryId,
      status: journalAttachments.status,
      bucket: journalAttachments.storageBucket,
      path: journalAttachments.storagePath,
      width: journalAttachments.width,
      height: journalAttachments.height,
      journalDate: journalEntries.journalDate,
    })
    .from(journalAttachments)
    .leftJoin(journalEntries, eq(journalEntries.id, journalAttachments.entryId))
    .where(eq(journalAttachments.id, attachmentId));

  // An unknown id, a pending upload and one this person may not see are all the same answer, so
  // guessing tells an attacker nothing.
  if (!attachment || attachment.status !== 'attached') throw notFound('photo');
  await assertCanAccessPerson(db, ctx, 'journal.proof.view', attachment.personId);

  const url = await getStorage().signedUrl({ bucket: attachment.bucket, path: attachment.path }, SIGNED_URL_SECONDS);
  await recordAudit(db, ctx, {
    category: 'access',
    action: 'journal.proof_viewed',
    entityType: 'journal_attachment',
    entityId: attachment.id,
    // The link itself is deliberately not recorded: it would be a working key in the log.
    newValues: { personId: attachment.personId, journalDate: attachment.journalDate },
  });

  return { url, width: attachment.width, height: attachment.height, expiresInSeconds: SIGNED_URL_SECONDS };
}

/**
 * Removes a photo from a journal, keeping the row so the record shows it happened. Used by
 * administrators when a member sends the wrong picture.
 */
export async function removeProof(db: Database, ctx: RequestContext, raw: unknown): Promise<void> {
  const { attachmentId } = parseInput(ProofViewInput, raw);
  const [attachment] = await db.select().from(journalAttachments).where(eq(journalAttachments.id, attachmentId));
  if (!attachment || attachment.status !== 'attached') throw notFound('photo');
  await assertCanAccessPerson(db, ctx, 'journal.proof.manage', attachment.personId);

  await db
    .update(journalAttachments)
    .set({ status: 'removed', removedAt: ctx.now, removedBy: ctx.actor.kind === 'user' ? ctx.actor.userId : null })
    .where(eq(journalAttachments.id, attachmentId));
  await discardObjects([{ bucket: attachment.storageBucket, path: attachment.storagePath }]);
  await recordAudit(db, ctx, {
    category: 'change',
    action: 'journal.proof_removed',
    entityType: 'journal_attachment',
    entityId: attachment.id,
    oldValues: { personId: attachment.personId, entryId: attachment.entryId },
  });
}

/**
 * Deletes pictures nobody is using: uploads whose journal was never sent, and proofs an
 * administrator removed. The rows stay; only the files go. Journals keep their proof for as long
 * as the ministry's retention policy says (docs/03 §9), which is "indefinitely" until it decides.
 */
export async function cleanupAbandonedProofs(db: Database, now: Date): Promise<{ deleted: number }> {
  const cutoff = new Date(now.getTime() - PENDING_HOURS * 3_600_000);
  const stale = await db
    .select({ id: journalAttachments.id, bucket: journalAttachments.storageBucket, path: journalAttachments.storagePath })
    .from(journalAttachments)
    .where(
      and(
        or(
          and(eq(journalAttachments.status, 'pending'), lt(journalAttachments.createdAt, cutoff), isNull(journalAttachments.entryId)),
          and(eq(journalAttachments.status, 'removed'), lt(journalAttachments.removedAt, cutoff)),
        ),
        isNull(journalAttachments.deletedFileAt),
      ),
    )
    .orderBy(asc(journalAttachments.createdAt))
    .limit(500);

  if (stale.length === 0) return { deleted: 0 };
  for (const object of stale) {
    await getStorage()
      .remove({ bucket: object.bucket, path: object.path })
      .catch((error: unknown) => logger.error('Could not delete an abandoned journal proof', error));
  }
  await db
    .update(journalAttachments)
    .set({ deletedFileAt: now })
    .where(inArray(journalAttachments.id, stale.map((s) => s.id)));
  return { deleted: stale.length };
}

/** The journal policy's proof rule, for the public page and the submission. */
export function proofRequired(policy: { proofImage: 'required' | 'optional' | 'off' }): boolean {
  return policy.proofImage === 'required';
}

export function assertProofPresent(policy: { proofImage: 'required' | 'optional' | 'off' }, hasProof: boolean): void {
  if (proofRequired(policy) && !hasProof) {
    throw validationError({ proof: ['A photo of your written journal is needed.'] }, 'Please add a photo of your written journal before sending it.');
  }
}
