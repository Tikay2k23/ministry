import { randomUUID } from 'node:crypto';
import type { RequestContext } from '../../context/request-context';
import type { JournalChannel } from '../../db/enums';

/** Request metadata for unauthenticated (participant) operations. */
export interface PublicRequest {
  now: Date;
  ip: string | null;
  userAgent: string | null;
  requestId?: string;
}

/** A participant identified by a remembered-device or session key (docs/02 §3). */
export interface ParticipantIdentity {
  keyId: string;
  personId: string;
  /** How the identity behind the key was established. */
  channel: Exclude<JournalChannel, 'proxy'>;
  /** false = "This isn't my phone" session key. Only remembered devices may edit or see their own journal. */
  persistent: boolean;
}

export function participantContext(req: PublicRequest, personId: string | null): RequestContext {
  return {
    requestId: req.requestId ?? randomUUID(),
    now: req.now,
    actor: personId ? { kind: 'participant', personId } : { kind: 'anonymous' },
    ip: req.ip ?? undefined,
    userAgent: req.userAgent ?? undefined,
  };
}

/** Coarse device description for "remembered devices" lists — never a fingerprint. */
export function deviceHint(userAgent: string | null): string | null {
  if (!userAgent) return null;
  const os = /Android/i.test(userAgent)
    ? 'Android'
    : /iPhone|iPad|iPod/i.test(userAgent)
      ? 'iPhone/iPad'
      : /Windows/i.test(userAgent)
        ? 'Windows'
        : /Mac OS/i.test(userAgent)
          ? 'Mac'
          : /Linux/i.test(userAgent)
            ? 'Linux'
            : 'Device';
  const browser = /Edg\//.test(userAgent)
    ? 'Edge'
    : /SamsungBrowser/.test(userAgent)
      ? 'Samsung Internet'
      : /Chrome\//.test(userAgent)
        ? 'Chrome'
        : /Firefox\//.test(userAgent)
          ? 'Firefox'
          : /Safari\//.test(userAgent)
            ? 'Safari'
            : 'Browser';
  return `${os} · ${browser}`;
}
