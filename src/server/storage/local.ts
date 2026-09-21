import { createHmac } from 'node:crypto';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { getEnv } from '../env';
import type { Storage, StoredObject } from './storage';

/**
 * Files in a directory, for development and the tests (STORAGE_DRIVER=local). The environment
 * refuses this driver in production.
 *
 * "Signed" links are served by /api/journal/proof/file, which checks the same signature this
 * makes, so local development exercises the same expiry behaviour as Supabase's signed URLs
 * rather than pretending files are public.
 */
export function localFileStorage(directory: string): Storage {
  // A path is only ever built from a bucket and a server-generated name, but a traversal here
  // would reach another bucket or the directory above, so every path is checked against its own
  // bucket before anything is opened.
  const resolve = (object: StoredObject) => {
    if (object.bucket.includes('/') || object.bucket.includes('\\') || object.bucket.includes('..')) {
      throw new Error('Refusing a storage path outside the storage directory.');
    }
    const bucketRoot = path.resolve(directory, object.bucket);
    const full = path.resolve(bucketRoot, object.path);
    if (!full.startsWith(bucketRoot + path.sep)) throw new Error('Refusing a storage path outside the storage directory.');
    return full;
  };

  return {
    async put(object, body) {
      const full = resolve(object);
      await mkdir(path.dirname(full), { recursive: true });
      await writeFile(full, body, { flag: 'wx' });
    },
    async get(object) {
      return readFile(resolve(object));
    },
    async remove(object) {
      await rm(resolve(object), { force: true });
    },
    async signedUrl(object, seconds) {
      const expires = Math.floor(Date.now() / 1000) + seconds;
      const token = signLocalObject(object, expires);
      const query = new URLSearchParams({ bucket: object.bucket, path: object.path, expires: String(expires), token });
      return `${getEnv().APP_URL}/api/journal/proof/file?${query.toString()}`;
    },
  };
}

/** The signature the local driver's links carry, and the route checks. */
export function signLocalObject(object: StoredObject, expires: number): string {
  const env = getEnv();
  return createHmac('sha256', env.APP_ENCRYPTION_KEY ?? env.BETTER_AUTH_SECRET)
    .update(`local-storage:${object.bucket}:${object.path}:${expires}`)
    .digest('base64url');
}
