import { z } from 'zod';

const EnvSchema = z
  .object({
    NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
    APP_URL: z.url(),
    DATABASE_URL: z.string().min(1),
    DATABASE_URL_MIGRATOR: z.string().min(1).optional(),
    BETTER_AUTH_SECRET: z.string().min(32, 'BETTER_AUTH_SECRET must be at least 32 characters'),
    BETTER_AUTH_URL: z.url(),
    EMAIL_PROVIDER: z.enum(['console', 'resend']).default('console'),
    EMAIL_API_KEY: z.string().optional(),
    EMAIL_FROM: z.string().default('GenTouch <no-reply@example.org>'),
    SEED_ADMIN_EMAIL: z.email().optional(),
    SEED_ADMIN_FIRST_NAME: z.string().optional(),
    SEED_ADMIN_LAST_NAME: z.string().optional(),
    SENTRY_DSN: z.string().optional(),
    /** How background jobs run (docs/02 §7, M3 note). */
    SCHEDULER_MODE: z.enum(['in_process', 'external', 'off']).default('in_process'),
    /** Required for SCHEDULER_MODE=external: the bearer token an external cron sends to /api/cron/tick. */
    CRON_SECRET: z.string().min(32, 'CRON_SECRET must be at least 32 characters').optional(),
  })
  .superRefine((env, ctx) => {
    if (env.NODE_ENV === 'production' && env.EMAIL_PROVIDER === 'console') {
      ctx.addIssue({ code: 'custom', path: ['EMAIL_PROVIDER'], message: 'console email is not allowed in production' });
    }
    if (env.NODE_ENV === 'production' && env.DATABASE_URL.startsWith('pglite:')) {
      ctx.addIssue({ code: 'custom', path: ['DATABASE_URL'], message: 'PGlite is for local development only' });
    }
    if (env.EMAIL_PROVIDER !== 'console' && !env.EMAIL_API_KEY) {
      ctx.addIssue({ code: 'custom', path: ['EMAIL_API_KEY'], message: 'required for this email provider' });
    }
    if (env.SCHEDULER_MODE === 'external' && !env.CRON_SECRET) {
      ctx.addIssue({ code: 'custom', path: ['CRON_SECRET'], message: 'required when SCHEDULER_MODE=external' });
    }
  });

export type Env = z.infer<typeof EnvSchema>;

let cached: Env | undefined;

/**
 * Validated environment. Parsed lazily so importing a module never fails at load time;
 * errors list variable names only (never values).
 */
export function getEnv(): Env {
  if (cached) return cached;
  const raw = Object.fromEntries(Object.entries(process.env).filter(([, value]) => value !== ''));
  const parsed = EnvSchema.safeParse(raw);
  if (!parsed.success) {
    const problems = parsed.error.issues.map((i) => `  - ${i.path.join('.')}: ${i.message}`).join('\n');
    throw new Error(`Invalid environment configuration:\n${problems}\nSee .env.example.`);
  }
  cached = parsed.data;
  return cached;
}
