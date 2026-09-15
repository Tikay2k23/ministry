/** Browser helpers shared by the login-free public pages (/j, /k). */

export interface ApiError {
  code: string;
  message: string;
  fieldErrors?: Record<string, string[]>;
  meta?: Record<string, unknown>;
}

export type ApiResult<T> = { ok: true; data: T } | { ok: false; status: number; error: ApiError };

const OFFLINE: ApiError = {
  code: 'OFFLINE',
  message: 'We couldn’t reach the server. Check your connection and try again — your answers are still here.',
};

/** Calls a public JSON route. Never throws: network failures come back as an OFFLINE error. */
export async function callApi<T>(method: 'GET' | 'POST' | 'PUT', url: string, body?: unknown): Promise<ApiResult<T>> {
  let response: Response;
  try {
    response = await fetch(url, {
      method,
      cache: 'no-store',
      credentials: 'same-origin',
      headers: body === undefined ? undefined : { 'Content-Type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  } catch {
    return { ok: false, status: 0, error: OFFLINE };
  }
  const json = (await response.json().catch(() => null)) as { data?: T; error?: ApiError } | null;
  if (response.ok && json && 'data' in json) return { ok: true, data: json.data as T };
  return {
    ok: false,
    status: response.status,
    error: json?.error ?? { code: 'INTERNAL', message: 'Something went wrong. Please try again.' },
  };
}

/** UUID v4 that also works on plain-HTTP origins, where crypto.randomUUID is unavailable. */
export function newIdempotencyKey(): string {
  if (typeof crypto.randomUUID === 'function' && globalThis.isSecureContext) return crypto.randomUUID();
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  bytes[6] = (bytes[6]! & 0x0f) | 0x40;
  bytes[8] = (bytes[8]! & 0x3f) | 0x80;
  const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

const inputBase =
  'block w-full rounded-xl border border-line-strong bg-surface px-4 text-[17px] text-ink placeholder:text-muted/70 ' +
  'focus:border-brand-deep focus:outline-none focus:ring-2 focus:ring-brand-deep/20 aria-[invalid=true]:border-error';

/** 48px-tall inputs for thumbs on small phones. */
export const publicInputClass = `${inputBase} h-12`;
export const publicTextareaClass = `${inputBase} py-3 leading-relaxed`;
