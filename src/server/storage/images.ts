import { createHash } from 'node:crypto';
import type { Sharp } from 'sharp';
import { validationError } from '../errors';
import { logger } from '../logger';

/**
 * Turning a photo a member sent into a file the ministry can keep. Shared by the journal's proof
 * photo (docs/02 §4) and the prayer report's photo, because the rules are the same ones.
 *
 * The bytes are never trusted: the image is decoded, which is what proves it really is a JPEG, PNG
 * or WebP whatever the filename or the browser claimed — then resized and re-encoded as WebP,
 * which also drops the EXIF block, so the ministry does not end up holding the GPS coordinates of
 * everybody's bedroom.
 */

/** What a phone may send. Bigger photos are refused with a plain message, not a truncated file. */
export const MAX_UPLOAD_BYTES = 5 * 1024 * 1024;
/** Enough to read handwriting, far less than a phone's 12–50 megapixels. */
export const MAX_DIMENSION = 2000;
/** Refuses a "small" file that decodes to a huge canvas (a decompression bomb). */
const MAX_INPUT_PIXELS = 60_000_000;
/** How long a viewing link lives. Long enough to open, short enough to be useless if copied. */
export const SIGNED_URL_SECONDS = 60;
/** An upload waits this long for whatever it belongs to before the cleanup job deletes it. */
export const PENDING_HOURS = 24;

/**
 * sharp carries tens of megabytes of native binaries. Loading it only when a photo actually
 * arrives keeps it out of the server's startup path — the cleanup jobs import this module — and
 * out of the journal and prayer routes' import graphs, where it delayed the first requests after a
 * cold start.
 */
const loadSharp = async () => (await import('sharp')).default;

const ACCEPTED = new Set(['jpeg', 'png', 'webp']);

export interface ProcessedImage {
  body: Buffer;
  mimeType: 'image/webp';
  width: number;
  height: number;
  checksum: string;
}

/**
 * Decodes, straightens and re-encodes a photo. Throws a member-friendly error if it is not an
 * image we accept — including a file renamed to .jpg, which fails to decode.
 */
export async function processUploadedImage(input: Buffer): Promise<ProcessedImage> {
  if (input.byteLength > MAX_UPLOAD_BYTES) {
    throw validationError({ file: ['Please choose an image smaller than 5 MB.'] });
  }

  const sharp = await loadSharp();
  let pipeline: Sharp;
  let format: string | undefined;
  try {
    pipeline = sharp(input, { limitInputPixels: MAX_INPUT_PIXELS, failOn: 'error' });
    format = (await pipeline.metadata()).format;
  } catch {
    throw validationError({ file: ['That file isn’t a photo we can read. Please send a JPG, PNG or WebP image.'] });
  }
  if (!format || !ACCEPTED.has(format)) {
    throw validationError({ file: ['Please send a JPG, PNG or WebP image.'] });
  }

  try {
    const { data, info } = await pipeline
      // `rotate()` with no angle applies the EXIF orientation, so a photo taken in portrait is
      // stored the right way up instead of on its side.
      .rotate()
      .resize({ width: MAX_DIMENSION, height: MAX_DIMENSION, fit: 'inside', withoutEnlargement: true })
      .webp({ quality: 82 })
      .toBuffer({ resolveWithObject: true });
    return {
      body: data,
      mimeType: 'image/webp',
      width: info.width,
      height: info.height,
      checksum: createHash('sha256').update(data).digest('hex'),
    };
  } catch (error) {
    logger.error('Could not process an uploaded image', error);
    throw validationError({ file: ['We couldn’t process that photo. Please try another one.'] });
  }
}
