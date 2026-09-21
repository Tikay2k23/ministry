import { storeProofUpload } from '@/server/modules/journal/proof.service';
import { assertFormSession } from '@/server/modules/public/participants.service';
import { publicJsonRoute } from '@/server/next/public-route';

/**
 * POST /api/public/journal/proof — a photo of a written journal, from the public journal page.
 *
 * The browser sends the picture here rather than straight to storage, so the service-role key
 * never leaves the server and the bytes are decoded, straightened, resized and stripped of EXIF
 * before anything is kept (docs/02 §4 "Journal proof"). The file waits as `pending` until the
 * journal itself is sent; if it never is, the cleanup job deletes it.
 *
 * Only a recognised device may upload, the request must come from our own origin, and both the
 * person and the connection are rate limited.
 */
export const POST = publicJsonRoute(
  async ({ db, req, requireIdentity, upload }) => {
    const identity = await requireIdentity();
    const { bytes, fields } = await upload('file');
    // The same page-freshness and not-a-robot check the journal itself uses.
    assertFormSession(fields.formSession ?? null, req.now);
    return storeProofUpload(db, identity, req, { body: bytes, journalDate: fields.journalDate });
  },
  { mutation: true },
);
