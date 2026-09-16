import { conflict } from '../../errors';

/** Stable, readable keys for vocabulary rows, e.g. "Tech / Sound" → "tech_sound" (docs/03 §4.12 `key`). */
export function keyFromName(name: string, fallback: string): string {
  const slug = name
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 50);
  return /^[a-z][a-z0-9_]+$/.test(slug) ? slug : `${fallback}_${slug}`.replace(/_+$/, '').slice(0, 50);
}

/** The base key, or the base with _2, _3, … when it is taken. */
export async function uniqueKey(base: string, isFree: (candidate: string) => Promise<boolean>): Promise<string> {
  for (let n = 1; n <= 50; n += 1) {
    const candidate = n === 1 ? base : `${base}_${n}`;
    if (await isFree(candidate)) return candidate;
  }
  throw conflict('Please choose a more distinctive name.');
}
