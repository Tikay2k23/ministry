import { z } from 'zod';

const EnvSchema = z
  .object({
    NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
    APP_URL: z.url(),
    DATABASE_URL: z.string().min(1),
    DATABASE_URL_MIGRATOR: z.string().min(1).optional(),
    BETTER_AUTH_SECRET: z.string().min(32, 'BETTER_AUTH_SECRET must be at least 32 characters'),
    BETTER_AUTH_URL: z.url(),
    /** Root key for app-level encryption and signing (src/server/crypto.ts). Defaults to BETTER_AUTH_SECRET. */
    APP_ENCRYPTION_KEY: z.string().min(32, 'APP_ENCRYPTION_KEY must be at least 32 characters').optional(),
    EMAIL_PROVIDER: z.enum(['console', 'file', 'resend']).default('console'),
    EMAIL_API_KEY: z.string().optional(),
    EMAIL_FROM: z.string().default('GenTouch <no-reply@example.org>'),
    /** EMAIL_PROVIDER=file: the directory messages are written to (end-to-end tests). */
    EMAIL_OUTBOX_DIR: z.string().min(1).default('.data/outbox'),
    SEED_ADMIN_EMAIL: z.email().optional(),
    SEED_ADMIN_FIRST_NAME: z.string().optional(),
    SEED_ADMIN_LAST_NAME: z.string().optional(),
    /** Error tracking. Without it, unexpected errors are only logged. */
    SENTRY_DSN: z.string().optional(),
    /** Where rate-limit counters live: Upstash Redis (production) or PostgreSQL (development and tests). */
    RATE_LIMIT_STORE: z.enum(['postgres', 'upstash']).default('postgres'),
    UPSTASH_REDIS_REST_URL: z.url().optional(),
    UPSTASH_REDIS_REST_TOKEN: z.string().min(1).optional(),
    /** How background jobs run (docs/02 §7). */
    SCHEDULER_MODE: z.enum(['in_process', 'external', 'off']).default('in_process'),
    /** Required for SCHEDULER_MODE=external: the bearer token Supabase Cron sends to /api/cron/tick. */
    CRON_SECRET: z.string().min(32, 'CRON_SECRET must be at least 32 characters').optional(),
  })
  .superRefine((env, ctx) => {
    if (env.NODE_ENV === 'production' && env.EMAIL_PROVIDER !== 'resend') {
      ctx.addIssue({ code: 'custom', path: ['EMAIL_PROVIDER'], message: 'console and file email are for development and tests only' });
    }
    if (env.NODE_ENV === 'production' && env.DATABASE_URL.startsWith('pglite:')) {
      ctx.addIssue({ code: 'custom', path: ['DATABASE_URL'], message: 'PGlite is for local development only' });
    }
    if (env.EMAIL_PROVIDER === 'resend' && !env.EMAIL_API_KEY) {
      ctx.addIssue({ code: 'custom', path: ['EMAIL_API_KEY'], message: 'required for this email provider' });
    }
    if (env.RATE_LIMIT_STORE === 'upstash' && (!env.UPSTASH_REDIS_REST_URL || !env.UPSTASH_REDIS_REST_TOKEN)) {
      ctx.addIssue({
        code: 'custom',
        path: ['UPSTASH_REDIS_REST_URL'],
        message: 'UPSTASH_REDIS_REST_URL and UPSTASH_REDIS_REST_TOKEN are required when RATE_LIMIT_STORE=upstash',
      });
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
