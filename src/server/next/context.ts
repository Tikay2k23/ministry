import 'server-only';
import { eq } from 'drizzle-orm';
import { headers } from 'next/headers';
import { redirect } from 'next/navigation';
import { randomUUID } from 'node:crypto';
import { cache } from 'react';
import { getAuth } from '../auth/auth';
import type { RequestContext } from '../context/request-context';
import { users } from '../db/schema';
import { isSensitive } from '../policy/catalog';
import { loadGrants } from '../policy/grants';
import { getDb } from './db';

export interface PortalUser {
  id: string;
  name: string;
  email: string;
  personId: string | null;
  twoFactorEnabled: boolean;
}

export interface PortalContext {
  ctx: RequestContext;
  user: PortalUser;
  sessionId: string;
  /** The account has 2FA but this session has not passed the second factor yet. */
  needsSecondFactor: boolean;
  /** The user's roles include sensitive permissions that stay locked until 2FA is set up. */
  sensitiveLocked: boolean;
}

export function clientIp(h: Headers): string | undefined {
  // Behind Cloudflare / the platform proxy, the first X-Forwarded-For entry is the client.
  return h.get('cf-connecting-ip') ?? h.get('x-forwarded-for')?.split(',')[0]?.trim() ?? undefined;
}

/** Resolves the signed-in portal user, their session state and effective grants (once per request). */
export const getPortalContext = cache(async (): Promise<PortalContext | null> => {
  const h = await headers();
  const result = await getAuth().api.getSession({ headers: h });
  if (!result) return null;

  const db = getDb();
  const [user] = await db.select().from(users).where(eq(users.id, result.user.id));
  if (!user || user.status === 'suspended' || user.status === 'deactivated') return null;

  const twoFactorVerifiedAt = (result.session as { twoFactorVerifiedAt?: Date | null }).twoFactorVerifiedAt ?? null;
  const twoFactorVerified = user.twoFactorEnabled && twoFactorVerifiedAt !== null;
  const now = new Date();
  const allGrants = await loadGrants(db, user.id, { now, twoFactorVerified: true });
  const grants = twoFactorVerified ? allGrants : allGrants.filter((g) => !isSensitive(g.permission));

  return {
    ctx: {
      requestId: h.get('x-request-id') ?? randomUUID(),
      now,
      actor: {
        kind: 'user',
        userId: user.id,
        personId: user.personId,
        name: user.name,
        email: user.email,
        grants,
        twoFactorVerified,
      },
      ip: clientIp(h),
      userAgent: h.get('user-agent') ?? undefined,
    },
    user: {
      id: user.id,
      name: user.name,
      email: user.email,
      personId: user.personId,
      twoFactorEnabled: user.twoFactorEnabled,
    },
    sessionId: result.session.id,
    needsSecondFactor: user.twoFactorEnabled && !twoFactorVerified,
    sensitiveLocked: grants.length !== allGrants.length,
  };
});

/** Use at the top of every portal page / server action. */
export async function requirePortal(): Promise<PortalContext> {
  const portal = await getPortalContext();
  if (!portal) redirect('/sign-in');
  if (portal.needsSecondFactor) redirect('/sign-in/verify');
  return portal;
}
