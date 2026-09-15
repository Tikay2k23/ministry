import 'server-only';
import { nextCookies } from 'better-auth/next-js';
import { getEmailProvider } from '../email/email';
import { getEnv } from '../env';
import { getDb } from '../next/db';
import { createAuth, type Auth } from './config';

let instance: Auth | undefined;

/** Better Auth for the Next.js runtime (see ./config.ts for the configuration itself). */
export function getAuth(): Auth {
  if (!instance) {
    const env = getEnv();
    instance = createAuth({
      db: getDb(),
      baseURL: env.BETTER_AUTH_URL,
      secret: env.BETTER_AUTH_SECRET,
      trustedOrigins: [env.APP_URL],
      sendEmail: (message) => getEmailProvider().send(message),
      extraPlugins: [nextCookies()], // must be last: lets server actions set auth cookies
    });
  }
  return instance;
}
