# Runbook: performance

> How this system is kept fast enough at the size the ministry is growing into, and what to do when
> it isn't. Companions: [deployment.md](deployment.md), [recovery.md](recovery.md). Milestone M5.5.

## 1. The targets

From docs/01 (§ non-functional requirements), measured as server time:

| | Target | Where it is measured |
|---|---|---|
| Sending a journal | **p95 ≤ 800 ms** | `load/journal-submit.js` |
| Portal dashboard and list pages | **p95 ≤ 800 ms**, at 50,000 people | `load/portal-browse.js`, and `npm run db:explain` for the database's share |
| Journal form, first load on a low-end phone | LCP ≤ 2.5 s on slow 4G, ≤ 90 KB of JavaScript | Lighthouse, by hand — not automated yet |
| Sustained submissions | 50 a second for 10 minutes | `load/journal-submit.js` |
| Concurrent portal users | 200 | `load/portal-browse.js` |

The ministry is ~1,900 people today. Everything here is sized for 50,000, which is the number the architecture was chosen for, so a bad query is found years before it would hurt anyone.

## 2. What runs on its own

The **Performance** workflow (`.github/workflows/performance.yml`) seeds 50,000 people into a throwaway PostgreSQL 17, then checks the query plans for the hottest pages. It runs weekly, whenever the schema, the services or the policy layer change, and on demand (Actions → Performance → Run workflow). The plans are kept as an artifact for 30 days.

It fails on two things:

- **A missing index** — a sequential scan of a large table that throws away almost everything it reads. Scanning the ledger to summarise a whole branch is fine; scanning it to find twelve people's rows is not.
- **A slow page** — a scenario whose statements together take more than 800 ms of database time.

## 3. Doing it by hand

```bash
# A disposable database, then a ministry to test against.
npm run db:migrate && npm run db:seed
npm run db:seed:load -- --allow-postgres                      # 50,000 people, 90 days
npm run db:seed:load -- --allow-postgres --days=1095 --entry-days=1095   # three years, slow

npm run db:check      # is the generated ministry sound?
npm run db:explain    # plans and timings for the hottest pages
```

`npm run db:explain` calls the real service functions, records every statement Drizzle runs and EXPLAINs each one with the same parameters, so it cannot drift from what the app does. Set `EXPLAIN_BUDGET_MS` to change the 800 ms budget.

## 4. The load tests (k6)

These need a deployed environment — run them against **staging, never production**: they write journals.

```bash
# Once, against staging's database: remembered-device keys for a few thousand people.
npm run db:load-keys -- --allow-postgres --count=3000 > load/keys.json

k6 run -e BASE_URL=https://staging.example.org load/journal-submit.js
k6 run -e BASE_URL=https://staging.example.org -e SESSION="gentouch.session_token=…" load/portal-browse.js
```

- **Why device keys:** submissions are limited to ten a minute **per person**, never per address, so a few thousand people behind the test exercises the real path without any exception to the rate limits. Identification *is* limited per address, which is why the keys are issued in the database instead.
- **Why one portal session:** sign-in links are limited on purpose. Sign in to staging in a browser, copy the session cookie, and let the virtual users share it. What is being measured is page time, not sign-in.
- `keys.json` lets its holder journal as those people. It is git-ignored; delete it when you are done, and never generate it against production.

## 5. When a target is missed

1. **Look at the plan first**, not at the code: `explain-plans.json` from the workflow artifact, or a local `npm run db:explain`. The scenario name tells you which page.
2. **A sequential scan of a large table** usually means a missing or unusable index. Add it as a migration (additive), and re-run. The ledger already has indexes for the three ways it is read: by leader and date, by branch (a GIN index on the date and the path), and the open-day partial index.
3. **A slow plan that uses its indexes** is usually too many rows: check whether the page should be paginated or the window narrowed.
4. **Fast database, slow page** means the time is in rendering or in the round trips. Count the statements: `npm run db:explain` prints how many each scenario runs, and a page that runs dozens is usually asking in a loop.
5. Record what you changed and the before-and-after timings in the pull request.

## 6. Known gaps

- The **public journal's first load** (LCP on a low-end phone over slow 4G) is not measured automatically. Until it is, check it by hand with Lighthouse before rollout — it is the number that matters most to members.
- The k6 runs are **not** in CI, because they need a deployed environment. When staging exists, a nightly run against it is worth adding.
- The load data is synthetic and evenly shaped: every leader has twelve people. A real ministry is lumpier, and a very large group would be the first place a page slows down.
