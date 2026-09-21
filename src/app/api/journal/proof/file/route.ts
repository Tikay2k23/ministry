import { timingSafeEqual } from 'node:crypto';
import type { NextRequest } from 'next/server';
import { getEnv } from '@/server/env';
import { signLocalObject } from '@/server/storage/local';
import { getStorage } from '@/server/storage/storage';

/**
 * GET /api/journal/proof/file — serves a photo for the local storage driver only.
 *
 * In production Supabase serves its own signed URLs and this route does nothing. In development
 * and the tests it stands in for them, checking the same signature and expiry, so the behaviour
 * a leader sees locally is the behaviour they get in production rather than "files are public
 * when there's no Supabase".
 */
export async function GET(request: NextRequest) {
  const env = getEnv();
  if (env.STORAGE_DRIVER !== 'local') return new Response('Not found', { status: 404 });

  const params = request.nextUrl.searchParams;
  const bucket = params.get('bucket') ?? '';
  const path = params.get('path') ?? '';
  const expires = Number(params.get('expires') ?? 0);
  const token = params.get('token') ?? '';
  if (!bucket || !path || !Number.isFinite(expires)) return new Response('Not found', { status: 404 });
  if (expires * 1000 < Date.now()) return new Response('This link has expired.', { status: 410 });

  const expected = Buffer.from(signLocalObject({ bucket, path }, expires));
  const presented = Buffer.from(token);
  if (presented.length !== expected.length || !timingSafeEqual(presented, expected)) {
    return new Response('Not found', { status: 404 });
  }

  try {
    const body = await getStorage().get({ bucket, path });
    return new Response(new Uint8Array(body), {
      headers: {
        'Content-Type': 'image/webp',
        // Private data: never stored by a shared cache, and never indexed.
        'Cache-Control': 'private, no-store',
        'X-Robots-Tag': 'noindex',
        'Content-Security-Policy': "default-src 'none'; sandbox",
      },
    });
  } catch {
    return new Response('Not found', { status: 404 });
  }
}
