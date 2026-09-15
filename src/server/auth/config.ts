import { betterAuth } from 'better-auth';
import { drizzleAdapter } from 'better-auth/adapters/drizzle';
import type { nextCookies } from 'better-auth/next-js';
import { magicLink } from 'better-auth/plugins';
import { eq, sql } from 'drizzle-orm';
import { randomUUID } from 'node:crypto';
import { newId } from '@/lib/ids';
import type { Database } from '../db/client';
import { authAccounts, authSessions, authVerifications, users } from '../db/schema';
import type { EmailMessage } from '../email/email';
import { magicLinkEmail } from '../email/templates';
import { recordAudit } from '../modules/audit/audit.service';

export const MAGIC_LINK_MINUTES = 15;

export interface AuthDependencies {
  db: Database;
  baseURL: string;
  secret: string;
  trustedOrigins: string[];
  sendEmail: (message: EmailMessage) => Promise<void>;
  /** Framework plugins appended last (the Next.js runtime passes `nextCookies()`). */
  extraPlugins?: ReturnType<typeof nextCookies>[];
}

/**
 * Better Auth handles sessions and passwordless magic links for portal users only.
 * - Invitation-only: sign-up is disabled; accounts are created by an administrator.
 * - The second factor is enforced by our own service (src/server/modules/iam/two-factor.service.ts)
 *   via `auth_sessions.two_factor_verified_at`, because Better Auth's 2FA plugin does not
 *   challenge magic-link sign-ins.
 * Participants (members using public forms) never use this — see docs/02 §3.
 * Framework-independent so it can be exercised by integration tests.
 */
export function createAuth(deps: AuthDependencies) {
  const { db } = deps;

  return betterAuth({
    appName: 'GenTouch',
    baseURL: deps.baseURL,
    secret: deps.secret,
    trustedOrigins: deps.trustedOrigins,
    database: drizzleAdapter(db, {
      provider: 'pg',
      schema: { user: users, session: authSessions, account: authAccounts, verification: authVerifications },
    }),
    emailAndPassword: { enabled: false },
    user: {
      additionalFields: {
        personId: { type: 'string', required: false, input: false },
        status: { type: 'string', required: false, input: false },
      },
    },
    session: {
      expiresIn: 60 * 60 * 24 * 30, // 30-day rolling session on a trusted device
      updateAge: 60 * 60 * 24,
      additionalFields: {
        twoFactorVerifiedAt: { type: 'date', required: false, input: false },
      },
    },
    advanced: {
      cookiePrefix: 'gentouch',
      database: { generateId: () => newId() },
    },
    rateLimit: { enabled: true, window: 60, max: 60 },
    databaseHooks: {
      session: {
        create: {
          // Suspended or deactivated accounts cannot sign in.
          before: async (session) => {
            const [user] = await db.select({ status: users.status }).from(users).where(eq(users.id, session.userId));
            if (!user || user.status === 'suspended' || user.status === 'deactivated') return false;
          },
          after: async (session) => {
            const now = new Date();
            const [user] = await db
              .update(users)
              .set({ status: sql`CASE WHEN ${users.status} = 'invited' THEN 'active' ELSE ${users.status} END`, lastLoginAt: now })
              .where(eq(users.id, session.userId))
              .returning({ personId: users.personId, name: users.name, email: users.email });
            await recordAudit(
              db,
              {
                requestId: randomUUID(),
                now,
                actor: {
                  kind: 'user',
                  userId: session.userId,
                  personId: user?.personId ?? null,
                  name: user?.name ?? '',
                  email: user?.email ?? '',
                  grants: [],
                  twoFactorVerified: false,
                },
                ip: session.ipAddress ?? undefined,
                userAgent: session.userAgent ?? undefined,
              },
              { category: 'auth', action: 'auth.signed_in', entityType: 'user', entityId: session.userId },
            );
          },
        },
      },
    },
    plugins: [
      magicLink({
        disableSignUp: true,
        expiresIn: MAGIC_LINK_MINUTES * 60,
        storeToken: 'hashed',
        sendMagicLink: async ({ email, url }) => {
          await deps.sendEmail(magicLinkEmail(email, url, MAGIC_LINK_MINUTES));
        },
      }),
      ...(deps.extraPlugins ?? []),
    ],
  });
}

export type Auth = ReturnType<typeof createAuth>;
