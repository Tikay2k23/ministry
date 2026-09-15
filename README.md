# GenTouch Ministry System

Ministry management and accountability system for **Generation Touch Harvest International** —
leadership hierarchy, daily journal, prayer chain and morning devotional.

- Product & architecture blueprint: [docs/README.md](docs/README.md)
- Progress: **M0 · Foundation** ✅, **M1 · People & Hierarchy** ✅, **M2 · Daily Journal** ✅ and the **stack alignment** ✅. **M3 · Prayer Chain** is in progress (see [docs/07-roadmap.md](docs/07-roadmap.md))

## Stack

Next.js 16 (App Router) · React 19 · TypeScript (strict) · Tailwind CSS 4 · shadcn/ui · React Hook Form ·
Zod · TanStack Table · Recharts · PostgreSQL (Supabase in production) · Drizzle ORM · Better Auth (magic
links; Supabase Auth is the approved target) · own TOTP two-step verification · Upstash Redis rate
limiting · Sentry · Vitest · Playwright · Node.js 24.

Hosting: Vercel, Supabase (Singapore), Cloudflare DNS, GitHub Actions. See the stack alignment note in
[docs/02 §1](docs/02-system-architecture.md).

Local development uses **PGlite** (PostgreSQL 17 running inside Node), so nothing needs to be
installed. Staging and production use Supabase PostgreSQL through the same code.

## Getting started

Requirements: Node.js 24 LTS (see `.nvmrc`).

```bash
npm install
cp .env.example .env        # then set BETTER_AUTH_SECRET (see the comment in the file)
npm run db:setup            # migrations + reference data + first Super Admin (SEED_ADMIN_EMAIL)
npm run dev                 # http://localhost:3000
```

Sign in with `SEED_ADMIN_EMAIL`. With `EMAIL_PROVIDER=console` the magic link is printed in the
terminal running `npm run dev`. Then open **My account** and turn on two-step verification — user
management and settings stay locked until you do.

> **PGlite note:** an embedded database directory can be opened by only one process at a time.
> Stop `npm run dev` before running `npm run db:migrate` or `npm run db:seed`.

## Scripts

| Command | What it does |
|---|---|
| `npm run dev` | Development server. It also runs the background jobs every minute |
| `npm run build` / `npm start` | Production build / server |
| `npm run check` | Type-check + lint + tests |
| `npm test` | Unit and integration tests (in-memory PostgreSQL) |
| `npm run test:e2e` | End-to-end tests in a browser (Playwright). Starts its own server on port 3100 with a fresh database, so it can run beside `npm run dev`. On a new computer, run `npx playwright install chromium` first |
| `npm run db:generate` | Generate a SQL migration from schema changes. Review it before committing; a new table also needs row-level security (see the top of `drizzle/0007_row_level_security.sql`) |
| `npm run db:migrate` | Apply pending migrations |
| `npm run db:seed` | Idempotent reference data + first Super Admin |
| `npm run db:seed:demo` | **Demo data only**: a fictional 1,885-person ministry (pastor → 12 → 144 → 1,728) with ministries and teams. Refuses to run in production |

### Demo accounts (after `npm run db:seed:demo`)

Sign in with these to see scoped views. The magic link prints in the `npm run dev` terminal.

| Email | Role | Sees |
|---|---|---|
| `primary.leader@demo.gentouch.test` | Primary Leader | Their whole branch (157 people) |
| `leader@demo.gentouch.test` | Leader | Their own group (13 people) |

### Try the Daily Journal (after `npm run db:seed:demo`)

1. **Get the leader's journal link.** Sign in as `leader@demo.gentouch.test` and open your own profile (the top of your Leadership tree). Choose **journal QR code**. The code points at `APP_URL`, so on this computer open its `/j/…` link in a second browser or a private window.
2. **Journal as a newcomer.** On that page, choose **I'm new here**, register, and send a journal. Try sending it again (it is refused), then edit it.
3. **See it in the portal.**
   - **Daily Journal** shows the entry.
   - **People → New registrations** lets you confirm the newcomer.
   - **Follow-ups** and **Reports** summarise how people are doing.

Journal answers and CSV exports are sensitive. They stay locked until the signed-in user turns on two-step verification.

## Deploying (Vercel + Supabase)

Not done yet. The code is prepared for it; these are the steps, in order.

1. **Supabase** (Singapore region): create the project. Set `DATABASE_URL` to the transaction pooler and `DATABASE_URL_MIGRATOR` to the session pooler or direct connection. Supabase connections need SSL with Supabase's certificate, which is configured at this step. Then run `npm run db:migrate` and `npm run db:seed` against it.
2. **App database role** (recommended): `CREATE ROLE app_rw LOGIN PASSWORD '…' IN ROLE gentouch_app;` and use `app_rw` in `DATABASE_URL`. The app then has no DDL rights and can only add audit entries, never change them.
3. **Upstash Redis:** set `RATE_LIMIT_STORE=upstash`, `UPSTASH_REDIS_REST_URL` and `UPSTASH_REDIS_REST_TOKEN`.
4. **Vercel:** import the GitHub repository and set the variables listed in `.env.example`, including `EMAIL_PROVIDER=resend`, `SCHEDULER_MODE=external` and a new `CRON_SECRET`. The Sentry variables are optional.
5. **Supabase Cron:** run `deploy/supabase-cron.sql` in the Supabase SQL editor, with the app's URL and `CRON_SECRET`.
6. **Cloudflare DNS:** point the domain at Vercel.

## Project layout

```
.github/workflows/        CI: type-check, lint, tests and build; migrations on PostgreSQL; end-to-end tests
deploy/                   Supabase Cron setup
docs/                     Blueprint (phases 1–7)
drizzle/                  SQL migrations (generated + hand-written)
src/app/                  Routes: sign-in, portal (/app), public journal (/j, /k, /privacy), API
src/components/           UI primitives (shadcn/ui-based), forms, data table, portal shell, journal status, brand
src/server/db/            Schema, client, migrations runner, seeds
src/server/policy/        Permission catalog, grants, scope checks
src/server/modules/       Domain services (hierarchy, people, forms, journal, prayer, notifications, scheduler,
                          public, care, reports, iam, settings, audit)
src/server/next/          Next.js glue (request context, db singleton, actions, routes, scheduler)
src/server/logger.ts      Structured logs without personal data
tests/                    Unit and integration tests (PGlite), end-to-end tests (tests/e2e), helpers
```
