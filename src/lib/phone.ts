import { parsePhoneNumberFromString, type CountryCode } from 'libphonenumber-js/max';

export type PhoneResult = { ok: true; e164: string } | { ok: false };

/**
 * Normalises a phone number to E.164 (docs/01 BR-P-01). Local formats use the ministry's
 * default country, so "0917 123 4567" becomes "+639171234567".
 */
export function normalizePhone(raw: string, defaultCountry = 'PH'): PhoneResult {
  const cleaned = raw.trim();
  if (!cleaned) return { ok: false };
  const parsed = parsePhoneNumberFromString(cleaned, defaultCountry as CountryCode);
  if (!parsed || !parsed.isValid()) return { ok: false };
  return { ok: true, e164: parsed.number };
}

/** National format for home-country numbers ("0917 123 4567"), international otherwise. */
export function formatPhone(e164: string, homeCountry = 'PH'): string {
  const parsed = parsePhoneNumberFromString(e164);
  if (!parsed) return e164;
  return parsed.country === homeCountry ? parsed.formatNational() : parsed.formatInternational();
}

/** True when a search term is plausibly a phone number rather than a name. */
export function looksLikePhone(term: string): boolean {
  return /^\+?[\d\s()-]{7,}$/.test(term.trim()) && (term.match(/\d/g)?.length ?? 0) >= 7;
}
