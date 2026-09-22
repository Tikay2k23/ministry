import { uploadReportPhotoFromChainPage, uploadReportPhotoWithActionLink } from '@/server/modules/prayer/participation.service';
import { assertFormSession } from '@/server/modules/public/participants.service';
import { publicJsonRoute } from '@/server/next/public-route';

/**
 * POST /api/public/prayer/report/photo — a photo from someone's prayer time, sent before the
 * report it belongs to (docs/02 §4). Multipart: the image, plus the personal link's `token` or the
 * `assignmentId` a remembered device is acting on. The bytes are decoded on the server, so the
 * filename and the declared type decide nothing.
 */
export const POST = publicJsonRoute(
  async ({ db, req, upload, requireIdentity }) => {
    const { bytes, fields } = await upload('photo');
    assertFormSession(fields.formSession ?? null, req.now);
    if (typeof fields.token === 'string') return uploadReportPhotoWithActionLink(db, req, fields, bytes);
    return uploadReportPhotoFromChainPage(db, await requireIdentity(), req, fields, bytes);
  },
  { mutation: true },
);
