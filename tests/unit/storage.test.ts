import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { localFileStorage, signLocalObject } from '@/server/storage/local';
import { proofPath } from '@/server/storage/storage';

/**
 * The local storage driver (development and tests). Production uses Supabase, but the rules it has
 * to keep are the same: a file is written once, links expire, and a path can never climb out of
 * the storage directory.
 */

let directory: string;
let storage: ReturnType<typeof localFileStorage>;

beforeAll(async () => {
  directory = await mkdtemp(path.join(tmpdir(), 'gentouch-storage-'));
  storage = localFileStorage(directory);
});

afterAll(async () => {
  await rm(directory, { recursive: true, force: true });
});

describe('local file storage', () => {
  it('writes a file, reads it back and deletes it', async () => {
    const object = { bucket: 'journal-proofs', path: 'person/2026-09-21/photo.webp' };
    await storage.put(object, Buffer.from('a picture'), 'image/webp');
    expect((await storage.get(object)).toString()).toBe('a picture');

    await storage.remove(object);
    await expect(storage.get(object)).rejects.toThrow();
  });

  it('never overwrites an existing file, so one upload cannot replace another', async () => {
    const object = { bucket: 'journal-proofs', path: 'person/2026-09-21/once.webp' };
    await storage.put(object, Buffer.from('first'), 'image/webp');
    await expect(storage.put(object, Buffer.from('second'), 'image/webp')).rejects.toThrow();
    expect((await storage.get(object)).toString()).toBe('first');
  });

  it('refuses a path that climbs out of the storage directory', async () => {
    for (const bad of ['../escaped.webp', 'person/../../escaped.webp', '../../.env']) {
      await expect(storage.put({ bucket: 'journal-proofs', path: bad }, Buffer.from('x'), 'image/webp'), bad).rejects.toThrow(
        /outside the storage directory/,
      );
    }
  });

  it('signs a link that carries its own expiry, and signs differently for every object', async () => {
    const object = { bucket: 'journal-proofs', path: 'person/2026-09-21/signed.webp' };
    await storage.put(object, Buffer.from('a picture'), 'image/webp');

    const url = new URL(await storage.signedUrl(object, 60));
    expect(url.pathname).toBe('/api/journal/proof/file');
    const expires = Number(url.searchParams.get('expires'));
    expect(expires * 1000).toBeGreaterThan(Date.now());
    expect(expires * 1000).toBeLessThanOrEqual(Date.now() + 61_000);

    // The route recomputes exactly this.
    expect(url.searchParams.get('token')).toBe(signLocalObject(object, expires));
    // A token for one moment does not work for another, nor for another file.
    expect(signLocalObject(object, expires + 1)).not.toBe(url.searchParams.get('token'));
    expect(signLocalObject({ ...object, path: 'person/2026-09-21/other.webp' }, expires)).not.toBe(url.searchParams.get('token'));
  });
});

describe('where a proof is kept', () => {
  it('names a file from ids alone, never from anything about the person', () => {
    const built = proofPath('01a0c458-3d62-75aa-98ef-b9f3248ca8bc', '2026-09-21', '01a0c44a-4a91-7589-9dd2-cb294e3af654', 'webp');
    expect(built).toBe('01a0c458-3d62-75aa-98ef-b9f3248ca8bc/2026-09-21/01a0c44a-4a91-7589-9dd2-cb294e3af654.webp');
    // Two photos on the same day never collide, because the id is the file name.
    expect(proofPath('p', '2026-09-21', 'a', 'webp')).not.toBe(proofPath('p', '2026-09-21', 'b', 'webp'));
  });
});
