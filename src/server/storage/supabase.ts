import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import type { Storage } from './storage';

/**
 * Supabase Storage, for production (STORAGE_DRIVER=supabase).
 *
 * The bucket is private and has no policies for `anon` or `authenticated`: the only way in is this
 * client, holding the service-role key on the server. The key must never reach the browser, which
 * is why the public journal uploads through our own route rather than straight to Supabase
 * (docs/02 §4 "Journal proof").
 *
 * Creating the bucket is a deployment step, not something the app does — see
 * docs/runbooks/deployment.md.
 */
export function supabaseStorage(url: string, serviceRoleKey: string): Storage {
  let client: SupabaseClient | undefined;
  const connect = () => {
    client ??= createClient(url, serviceRoleKey, { auth: { persistSession: false, autoRefreshToken: false } });
    return client;
  };

  return {
    async put(object, body, contentType) {
      const { error } = await connect().storage.from(object.bucket).upload(object.path, body, { contentType, upsert: false });
      if (error) throw new Error(`Could not store the file: ${error.message}`);
    },
    async get(object) {
      const { data, error } = await connect().storage.from(object.bucket).download(object.path);
      if (error || !data) throw new Error(`Could not read the file: ${error?.message ?? 'missing'}`);
      return Buffer.from(await data.arrayBuffer());
    },
    async remove(object) {
      const { error } = await connect().storage.from(object.bucket).remove([object.path]);
      if (error) throw new Error(`Could not remove the file: ${error.message}`);
    },
    async signedUrl(object, seconds) {
      const { data, error } = await connect().storage.from(object.bucket).createSignedUrl(object.path, seconds);
      if (error || !data) throw new Error(`Could not sign the file: ${error?.message ?? 'missing'}`);
      return data.signedUrl;
    },
  };
}
