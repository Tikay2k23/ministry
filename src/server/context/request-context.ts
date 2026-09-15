import { randomUUID } from 'node:crypto';
import type { Grant } from '../policy/grants';

/**
 * Everything a service needs to know about who is acting and when (docs/02 §2 rule 3).
 * Services never read globals; the clock is injectable for tests.
 */
export type Actor =
  | {
      kind: 'user';
      userId: string;
      personId: string | null;
      name: string;
      email: string;
      grants: readonly Grant[];
      /** True when the account has 2FA enabled (sessions only exist after the second factor). */
      twoFactorVerified: boolean;
    }
  | { kind: 'participant'; personId: string }
  | { kind: 'anonymous' }
  | { kind: 'system'; job: string };

export interface RequestContext {
  requestId: string;
  now: Date;
  actor: Actor;
  ip?: string;
  userAgent?: string;
}

export function systemContext(job: string, now: Date = new Date()): RequestContext {
  return { requestId: randomUUID(), now, actor: { kind: 'system', job } };
}

export function actorUserId(ctx: RequestContext): string | null {
  return ctx.actor.kind === 'user' ? ctx.actor.userId : null;
}
