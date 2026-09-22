import { getEnv } from '../env';
import { localFileStorage } from './local';
import { supabaseStorage } from './supabase';

/**
 * Private object storage for journal proof photos (docs/02 §4 "Journal proof").
 *
 * Two drivers, chosen by STORAGE_DRIVER, the same shape as the email providers and the rate-limit
 * stores: a local directory for development and tests, and Supabase Storage in production. Nothing
 * here is ever public — a viewer gets a link that expires in a minute, and only after the policy
 * layer has said they may look.
 */
export interface StoredObject {
  bucket: string;
  path: string;
}

export interface Storage {
  /** Writes bytes at a server-chosen path. Refuses to overwrite: paths carry a random id. */
  put(object: StoredObject, body: Buffer, contentType: string): Promise<void>;
  /** A link that works for `seconds` and then stops. */
  signedUrl(object: StoredObject, seconds: number): Promise<string>;
  /** Reads the bytes back (the tests, and any future re-processing). */
  get(object: StoredObject): Promise<Buffer>;
  remove(object: StoredObject): Promise<void>;
}

let storage: Storage | undefined;

export function getStorage(): Storage {
  if (storage) return storage;
  const env = getEnv();
  storage = env.STORAGE_DRIVER === 'supabase' ? supabaseStorage(env.SUPABASE_URL!, env.SUPABASE_SERVICE_ROLE_KEY!) : localFileStorage(env.STORAGE_DIR);
  return storage;
}

/** Test hook, as for the email provider and the rate-limit store. */
export function setStorage(custom: Storage | undefined): void {
  storage = custom;
}

/**
 * A path the server controls entirely: the person's id (not their name, phone or email), the
 * journal's date, and a random name. Nothing in it can be guessed from knowing someone, and
 * nothing in it leaks who the file belongs to if a path is ever seen.
 */
export function proofPath(personId: string, journalDate: string, id: string, extension: string): string {
  return `${personId}/${journalDate}/${id}.${extension}`;
}

/** Prayer report photos share the bucket, under their own prefix. The path still names nobody. */
export function prayerReportPath(personId: string, chainDate: string, id: string, extension: string): string {
  return `prayer-report/${personId}/${chainDate}/${id}.${extension}`;
}
