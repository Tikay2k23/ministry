import { randomInt } from 'node:crypto';
import { uuidv7 } from 'uuidv7';

/** Time-ordered, non-enumerable primary key (docs/03 §1). */
export function newId(): string {
  return uuidv7();
}

/** Crockford base32: no I, L, O, U — easy to read aloud and type from a printed card. */
export const CROCKFORD_ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';

export function randomCode(length: number): string {
  let out = '';
  for (let i = 0; i < length; i++) out += CROCKFORD_ALPHABET[randomInt(CROCKFORD_ALPHABET.length)];
  return out;
}

/** Human-friendly, non-sequential person code, e.g. `P-7K3M9Q`. */
export function newPersonCode(): string {
  return `P-${randomCode(6)}`;
}

/**
 * Normalises a code typed by a person: uppercase, strips spaces/hyphens and maps the
 * characters Crockford base32 treats as ambiguous (O→0, I/L→1).
 */
export function normalizeCode(input: string): string {
  return input
    .toUpperCase()
    .replace(/[\s-]/g, '')
    .replace(/O/g, '0')
    .replace(/[IL]/g, '1');
}
