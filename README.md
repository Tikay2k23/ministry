# GenTouch Ministry System

Ministry management and accountability system for **Generation Touch Harvest International** —
leadership hierarchy, daily journal, prayer chain and morning devotional.

- Product & architecture blueprint: [docs/README.md](docs/README.md)
- Progress: **M0 · Foundation** ✅, **M1 · People & Hierarchy** ✅ and **M2 · Daily Journal** ✅. Next is **M3 · Prayer Chain** (see [docs/07-roadmap.md](docs/07-roadmap.md))

## Stack

Next.js (App Router) · React · TypeScript (strict) · Tailwind CSS · PostgreSQL · Drizzle ORM ·
Better Auth (magic links) · own TOTP two-step verification · Vitest.

Local development uses **PGlite** (PostgreSQL 17 running inside Node) so nothing needs to be
installed. Staging and production use a managed PostgreSQL via the same code.

## Getting started

Requirements: Node.js 22.12+ (24 recommended).

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
| `npm run dev` | Development server |
| `npm run build` / `npm start` | Production build / server |
| `npm run check` | Type-check + lint + tests |
| `npm test` | Unit and integration tests (in-memory PostgreSQL) |
| `npm run db:generate` | Generate a SQL migration from schema changes (review before committing) |
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

## Project layout

```
docs/                     Blueprint (phases 1–7)
drizzle/                  SQL migrations (generated + hand-written)
src/app/                  Routes: sign-in, portal (/app), public journal (/j, /k, /privacy), API
src/components/           UI primitives, portal shell, journal status, brand
src/server/db/            Schema, client, migrations runner, seeds
src/server/policy/        Permission catalog, grants, scope checks
src/server/modules/       Domain services (hierarchy, people, forms, journal, public, care, reports, iam, settings, audit)
src/server/next/          Next.js glue (request context, db singleton, actions)
tests/                    Integration tests (PGlite) and helpers
```
