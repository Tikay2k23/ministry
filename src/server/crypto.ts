import { createCipheriv, createDecipheriv, createHash, createHmac, hkdfSync, randomBytes, timingSafeEqual } from 'node:crypto';
import { getEnv } from './env';

/**
 * Small, explicit crypto helpers.
 * Keys are derived per purpose with HKDF from APP_ENCRYPTION_KEY. It falls back to
 * BETTER_AUTH_SECRET, which was the root key before the two were separated, so existing encrypted
 * and signed values stay valid: set APP_ENCRYPTION_KEY to that same value before authentication
 * moves off Better Auth. Changing the root key invalidates encrypted values (e.g. TOTP secrets →
 * users re-enrol). Dedicated, versioned field-encryption keys arrive with V1
 * (FIELD_ENCRYPTION_KEYS, docs/02 §8.3).
 */

function deriveKey(purpose: string): Buffer {
  const env = getEnv();
  return Buffer.from(hkdfSync('sha256', env.APP_ENCRYPTION_KEY ?? env.BETTER_AUTH_SECRET, 'gentouch-v1', purpose, 32));
}

/** AES-256-GCM. Output: `v1.<iv>.<tag>.<ciphertext>` (base64url). */
export function encryptString(plaintext: string, purpose: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', deriveKey(purpose), iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  return ['v1', iv.toString('base64url'), cipher.getAuthTag().toString('base64url'), ciphertext.toString('base64url')].join('.');
}

export function decryptString(payload: string, purpose: string): string {
  const [version, iv, tag, ciphertext] = payload.split('.');
  if (version !== 'v1' || !iv || !tag || !ciphertext) throw new Error('Unsupported encrypted payload.');
  const decipher = createDecipheriv('aes-256-gcm', deriveKey(purpose), Buffer.from(iv, 'base64url'));
  decipher.setAuthTag(Buffer.from(tag, 'base64url'));
  return Buffer.concat([decipher.update(Buffer.from(ciphertext, 'base64url')), decipher.final()]).toString('utf8');
}

export function sha256Hex(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

/** URL-safe random secret (default 256 bits). */
export function randomToken(bytes = 32): string {
  return randomBytes(bytes).toString('base64url');
}

/** Keyed hash for values that must be looked up but never stored raw (phone numbers, IPs). */
export function hmacHex(value: string, purpose: string): string {
  return createHmac('sha256', deriveKey(purpose)).update(value).digest('hex');
}

/** Tamper-proof, non-secret payload: `<base64url json>.<base64url hmac>`. */
export function signPayload(payload: Record<string, unknown>, purpose: string): string {
  const body = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const mac = createHmac('sha256', deriveKey(purpose)).update(body).digest('base64url');
  return `${body}.${mac}`;
}

export function verifyPayload<T extends Record<string, unknown>>(token: string, purpose: string): T | null {
  const [body, mac] = token.split('.');
  if (!body || !mac) return null;
  const expected = createHmac('sha256', deriveKey(purpose)).update(body).digest();
  const given = Buffer.from(mac, 'base64url');
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) return null;
  try {
    return JSON.parse(Buffer.from(body, 'base64url').toString('utf8')) as T;
  } catch {
    return null;
  }
}
