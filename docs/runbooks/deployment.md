# Runbook: deployment

> How this app goes live on Vercel and Supabase, and what to do on every deployment after.
> Companion: [recovery.md](recovery.md). Milestone M5.6 (docs/07-roadmap.md).
> Blanks marked ✎ are filled in once, when the accounts exist.

| | |
|---|---|
| Production URL | ✎ |
| Vercel project | ✎ |
| Supabase project (Singapore) | ✎ |
| Who can deploy | ✎ |
| Who to call | ✎ |

## 1. Accounts to create first

| Service | Plan note |
|---|---|
| **Supabase**, Singapore region | Nearest region to the Philippines. Point-in-time recovery needs a paid plan — see [recovery.md](recovery.md) §1 before choosing |
| **Vercel**, project region Singapore (`sin1`) | Every page runs through `src/proxy.ts` for its CSP nonce, so a region far from the database is felt on every request |
| **Resend**, with the ministry's sending domain verified (SPF, DKIM) | Production refuses any other email provider. Unverified domains land in spam, and sign-in links are how leaders get in |
| **Upstash Redis** | Rate-limit counters shared by every serverless instance |
| **Sentry** (optional) | Errors and source maps |
| **Cloudflare** (or the current DNS host) | The custom domain |

## 2. Secrets

Generate each one yourself and paste it straight into Vercel; nobody needs to see it afterwards:

```bash
node -e "console.log(crypto.randomBytes(32).toString('base64url'))"
```

- `BETTER_AUTH_SECRET` — signs session cookies. Changing it later signs everyone out.
- `APP_ENCRYPTION_KEY` — **set this explicitly, even though it falls back to `BETTER_AUTH_SECRET`.** It encrypts two-step-verification secrets. If it is left unset, rotating the session secret also forces every leader to re-enrol their authenticator app. Set both from the start and they can be rotated independently.
- `CRON_SECRET` — the bearer token Supabase Cron presents to `/api/cron/tick`.

## 3. Environment variables

Everything in `.env.example` applies; these are the ones production needs to be right.

| Variable | Value in production |
|---|---|
| `APP_URL`, `BETTER_AUTH_URL` | The public URL, no trailing slash (e.g. `https://app.gentouch.org`) |
| `DATABASE_URL` | Supabase **transaction pooler**, as the `app_rw` role (§4) |
| `DATABASE_URL_MIGRATOR` | Supabase **session pooler or direct connection**, as the owner. Only used by `npm run db:migrate` from a laptop, never by the running app |
| `EMAIL_PROVIDER` | `resend` (the app refuses anything else in production) |
| `EMAIL_API_KEY`, `EMAIL_FROM` | From Resend; the from-address must be on the verified domain |
| `SCHEDULER_MODE` | `external` — serverless instances cannot hold a timer. With `CRON_SECRET`, jobs run from Supabase Cron (§7) |
| `RATE_LIMIT_STORE` | `upstash`, with `UPSTASH_REDIS_REST_URL` and `UPSTASH_REDIS_REST_TOKEN` |
| `SEED_ADMIN_EMAIL` | **A real address you can open.** The seed makes it the first Super Admin; get it wrong and nobody can sign in |
| `SENTRY_DSN`, `NEXT_PUBLIC_SENTRY_DSN` | Optional. `SENTRY_ORG`, `SENTRY_PROJECT`, `SENTRY_AUTH_TOKEN` upload source maps at build time |
| `NODE_ENV` | Vercel sets this to `production` itself |

## 4. First deployment

1. **Create the Supabase project** (Singapore). Note the two connection strings.
2. **Apply the schema from your laptop**, not from Vercel:
   ```bash
   DATABASE_URL_MIGRATOR="<session pooler URL>" npm run db:migrate
   SEED_ADMIN_EMAIL="you@example.org" npm run db:seed
   ```
   `db:seed` writes permissions, roles, leadership levels, designations, serving roles, the default journal form and the general QR code. It is safe to run again.
3. **Create the app's own database role**, so the running app cannot change the schema or rewrite audit history:
   ```sql
   CREATE ROLE app_rw LOGIN PASSWORD '<a long random password>' IN ROLE gentouch_app;
   ```
   Use `app_rw` in `DATABASE_URL`. `gentouch_app` and its row-level-security policies come from migration 0007.
4. **Upstash**: create the database, then set the three rate-limit variables.
4b. **Storage for journal photos** (Supabase → Storage):
   - Create a bucket named `journal-proofs` and leave it **private**. Do not add any policy for `anon` or `authenticated`: the app reaches it with the service-role key from the server, and viewers only ever get links that expire after a minute.
   - Set `STORAGE_DRIVER=supabase`, `STORAGE_BUCKET=journal-proofs`, `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` in Vercel. The service-role key is server-only — it must never appear in a `NEXT_PUBLIC_` variable.
   - These photos are the most sensitive files the ministry holds: a page of someone's handwriting, often mentioning other people. Treat the bucket like the database, and settle the retention question in [recovery.md](recovery.md) before the pilot grows.
5. **Vercel**: import the GitHub repository, set the region to Singapore, add every variable from §3, and deploy.
6. **Check it before telling anyone the address**:
   ```bash
   npm run smoke -- https://your-app.vercel.app
   ```
   32 checks: the database is reachable, each page carries a fresh nonce and its security headers, the portal turns strangers away, personal-link pages leak no token, cross-site posts are refused, and the job endpoint needs its secret.
7. **Sign in** as `SEED_ADMIN_EMAIL`, then **turn on two-step verification immediately** (My account). Until you do, settings, imports and journal answers stay locked.
8. **Supabase Cron**: run `deploy/supabase-cron.sql` in the SQL editor, with the app's URL and `CRON_SECRET`. Needs the `pg_cron` and `pg_net` extensions.
9. **Confirm the jobs are running**: the System health page (`/app/admin/health`) should show recent runs and no stalled-scheduler warning within a few minutes.
10. **DNS**: point the domain at Vercel, then update `APP_URL` and `BETTER_AUTH_URL` to the final address and redeploy. Printed QR codes contain this URL — settle the domain **before** printing anything.
11. **Uptime monitoring** (optional but cheap): point a monitor at `GET /api/health` every 5 minutes. It returns 200 `{"status":"ok"}`, or 503 when the database is unreachable.

## 5. Every deployment after

1. Merge to `main`. CI must be green: type-check, lint, 225 tests, the production build, migrations on PostgreSQL 17, the backup-and-restore drill, and the end-to-end suite.
2. **If the change includes a migration** (`drizzle/` has a new file), apply it **before** the code deploys:
   ```bash
   DATABASE_URL_MIGRATOR="<session pooler URL>" npm run db:migrate
   ```
   Migrations here are only ever additive, so the currently running version keeps working against the new schema. That is what makes step 3 safe.
3. Vercel builds and promotes the deployment automatically.
4. `npm run smoke -- https://<production URL>` again, and glance at the System health page.

## 6. Rolling back

- **Promote the previous deployment** in Vercel (Deployments → the previous one → Promote to Production). Because migrations are additive, the older code still runs against the current schema.
- If the release included a migration that the older code cannot tolerate, say so in the pull request; that is the one case where a rollback needs a database change, and it should be avoided rather than handled.
- Data mistakes are **not** fixed by rolling back the app: see [recovery.md](recovery.md) §3.

## 7. What runs on its own

| Job | When | Where it shows |
|---|---|---|
| `journal.ledger` (open, resync, close a day) | Every tick | System health |
| Reminders, overdue checks, roster notices | Every tick | System health · Notifications |
| Alerts to administrators when a job fails | On failure | Email and the in-app inbox |

Supabase Cron calls `/api/cron/tick` every minute with the bearer token. Each job is idempotent and lease-protected, so a missed, slow or repeated tick is harmless. If the scheduler stalls for 15 minutes, the System health page says so.

## 8. Before real members use it

Deploying is not the same as opening it to the ministry. The pilot plan's readiness checklist ([../pilot/pilot-plan.md](../pilot/pilot-plan.md) §5) is the list, and the blocking items are: the privacy notice published in place of the draft, a restore rehearsed against the real Supabase project, and the leaders' accounts invited with two-step verification on.
