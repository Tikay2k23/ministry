import type { Storage, StoredObject } from '@/server/storage/storage';

/**
 * Object storage in memory, for tests. Behaves like the real drivers where it matters: it refuses
 * to overwrite an existing path, and its signed links carry an expiry that can be checked.
 */
export interface MemoryStorage extends Storage {
  objects: Map<string, Buffer>;
  /** What a link's expiry was set to, so a test can prove it is short-lived. */
  lastSignedSeconds: number | null;
}

const key = (object: StoredObject) => `${object.bucket}/${object.path}`;

export function memoryStorage(): MemoryStorage {
  const objects = new Map<string, Buffer>();
  const storage: MemoryStorage = {
    objects,
    lastSignedSeconds: null,
    async put(object, body) {
      if (objects.has(key(object))) throw new Error('That path already exists.');
      objects.set(key(object), body);
    },
    async get(object) {
      const body = objects.get(key(object));
      if (!body) throw new Error('No such object.');
      return body;
    },
    async remove(object) {
      objects.delete(key(object));
    },
    async signedUrl(object, seconds) {
      if (!objects.has(key(object))) throw new Error('No such object.');
      storage.lastSignedSeconds = seconds;
      const expires = Math.floor(Date.now() / 1000) + seconds;
      return `https://storage.test/${key(object)}?expires=${expires}&token=test-signature`;
    },
  };
  return storage;
}
