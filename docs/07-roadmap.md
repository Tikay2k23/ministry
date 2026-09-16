# Phase 7 — Development Roadmap & Quality Strategy

> Part of the **Ministry System — Product & Architecture Blueprint**.

---

## 1. Approach

- **Vertical slices.** Each milestone ships something usable end to end (database → service → UI → tests), not "all the backend first".
- **Pilot before rollout.** One Primary Leader's branch (~156 people) uses the system for two weeks before the whole ministry does.
- **Foundations built properly once.** Authorisation, audit, hierarchy and the ledger are hard to retrofit, so they're built right in the MVP. Nice-to-haves (SMS, PDF, rollups) wait.

**Build first: Leadership Hierarchy + Import.** Everything else asks "who is under whom?" Journal is the highest daily value, so it comes immediately after. Prayer and Devotional follow in your priority order.

---

## Progress

| Milestone | Status | Verified by |
|---|---|---|
| M0 · Foundation | ✅ Done 2026-09-14 | 35 integration tests, production build, 14-check HTTP smoke test |
| M1 · People & Hierarchy | ✅ Done 2026-09-14 | 64 integration tests (incl. hierarchy property tests, scope/IDOR cases, import), production build, 20-check HTTP smoke test on a 1,885-person demo ministry |
| M2 · Daily Journal | ✅ Done 2026-09-15 | 121 tests in 18 files, covering ledger time-travel, idempotent and concurrent submissions, identification, content visibility by sensitivity tier, review, pauses and rest days, proxy journals, registrations, reports and CSV. Also a production build (49 routes), a 35-check public-journal HTTP smoke test and an 8-check reports smoke test on the demo ministry |
| Stack alignment | ✅ Done 2026-09-15 | The approved stack adopted without rewriting M1–M2 (docs/02 §1 note): row-level security baseline (migration 0007), in-app scheduler triggered by Supabase Cron, Upstash rate limiting, Sentry, structured logs, shadcn/ui, React Hook Form, TanStack Table, Recharts, Node 24 and GitHub Actions. Verified by type-check, lint, 152 tests in 24 files, a production build (51 routes) and 2 Playwright end-to-end tests (portal sign-in → people → leadership → journal on desktop; the public journal on a phone). Not yet exercised against real Supabase, Upstash, Sentry or GitHub, which need accounts |
| M3 · Prayer Chain | ✅ Done 2026-09-16 | Built: chains, schedules, standing commitments, slot generation, assignments, substitutes and coordinator follow-up; the public chain page and personal links; the portal chain list, board and setup pages; slot reminders and the overdue check; the in-app inbox; the dashboard tile; the completion report with CSV. Verified by type-check, lint, 167 tests in 25 files (19 for the prayer chain and scheduler, covering time zones and midnight, grace and follow-up, scope, anonymity and reports), a production build (63 routes) and 3 Playwright end-to-end tests. The new test creates and starts a chain, assigns a member, shares their link, confirms on a phone and finds the slot on the chain page. The 7-day staging run is still to do (see the gaps below) |

Implementation changes are recorded as notes in docs/02, 02a, 03 and 06.

Known M1 gaps, planned for later:
- merge tool (V1)
- restoring archived people
- ending team memberships from the UI
- leadership-level and settings screens (M5)
- a visual walkthrough in a browser

Known M2 gaps, planned for later:
- a Playwright suite on throttled 3G (Playwright itself is in place since 2026-09-15)
- journal summaries by ministry or department
- journal reminders and leader digests (the scheduler they need exists since 2026-09-15)
- a Turnstile challenge
- step-up re-authentication before exports
- a PWA manifest
- a participant history view (V1)
- converting the M0 invite form to the onSubmit pattern

Known M3 gaps, planned for later:
- the exit criterion itself: a 24-hour chain running for 7 days in staging with simulated participants (it needs a staging environment)
- status and person filters on the chain board
- unavailability warnings when assigning
- a leader's view of their own people's prayer participation (docs/06 note g)
- ending a schedule that hasn't started yet leaves its first day in place
- the notification template editor and delivery log (A24)
- a visual walkthrough on a phone (so far the screens are exercised only by Playwright)

## 2. MVP (Priority 1–4)

Indicative effort: **~12–13 weeks for one senior full-stack developer working with me**, or ~8 weeks with two developers.

| Milestone | Scope | Exit criteria |
|---|---|---|
| **M0 · Foundation** (≈2 wks) | Repo, TypeScript strict, lint, CI; Docker Compose Postgres; Drizzle + migration pipeline; Better Auth (magic link + TOTP, invitation-only); `RequestContext`; **policy layer + permission catalog + seeded roles**; audit logging; settings store; design-system primitives (Button, Field, DataTable, StatusChip, Sheet, Skeleton, EmptyState); portal shell + nav + scope switcher; public layout; error/loading conventions; Sentry; health endpoint | A user can be invited, sign in with 2FA, and see an empty dashboard; permission unit tests green |
| **M1 · People & Hierarchy** (≈2.5 wks) | People CRUD + search/filter/pagination; designations; duplicate detection + review queue; **hierarchy service** (place/move/reassign, closure, advisory lock, history); leadership levels; tree explorer; branch view; profile with chain of leadership; leader change requests; ministries/departments/teams (basic); **CSV import with hierarchy** + preview *(entry codes + leader QR moved to M2, together with the public journal page they open)* | Real spreadsheet imported into staging; closure verified against recursive CTE by property tests; branch scoping tests green |
| **M2 · Daily Journal** (≈3 wks) | Forms engine + basic builder (types: short/long text, yes/no, choices, number, scripture ref, prayer request/testimony/reflection/gratitude as long-text variants, date/time); public `/j`, `/j/{code}`, **entry codes + printable leader QR cards (moved from M1)**, identification ladder, registration, device keys, personal links; submit/edit with idempotency; ledger jobs (`open_day`, `resync_day`, `close_day`); rest days & pauses; leader Today; review queue; entry view with sensitivity tiers + access log; branch & ministry summaries; 7/30-day consistency; streak follow-ups; Follow-ups page (journal kinds); proxy submission; dashboard journal tile; reports: daily, weekly, branch, people directory + CSV | Pilot-ready: a leader can see 12 people, read and review; duplicate/concurrency tests green; Playwright mobile suite green on throttled 3G |
| **M3 · Prayer Chain** (≈2 wks) | Chains, schedules (rrule), slot generation, commitments, assignments with overlap protection; chain board; public chain page + action links (confirm / check-in / complete / can't make it); prayer report form; `check_overdue` → follow-ups; coordinator resolution; substitutes; dashboard prayer tile; completion report | A 24-hour chain runs for 7 days in staging with simulated participants; midnight and grace tests green |
| **M4 · Devotional / Worship** (≈1.5 wks) | Serving roles, gathering types + roster template, worship teams + default roles, schedules with rotation, generation with auto-fill, roster editing with warnings, publish with action links, accept/decline, substitute suggestions, dashboard devotional tile | Four weeks of rotation generated correctly; manual edits survive regeneration |
| **M5 · Hardening & Pilot** (≈1.5–2 wks) | Full permission-matrix test suite; security review + ZAP baseline + header checks; k6 load tests on 50k synthetic people; accessibility audit (axe + manual screen reader); privacy notice + consent flow; backup/restore drill; alerting; printable QR cards; leader quick-start guide (1 page) + 3-minute video script; production deployment; **pilot with one branch** | Pilot branch uses it daily for 2 weeks; issues triaged; go/no-go for full rollout |

**Explicitly not in the MVP** (by design, not forgotten): SMS/OTP, web push, reminders by SMS, rollup tables, PDF export, passkeys, field-level encryption, RLS, per-person timezone, prayer self-sign-up, custom-role editor, merge UI, pastoral notes, Filipino localisation, participant history view.

MVP notifications = **in-app + email + Share buttons** (Messenger/Viber/WhatsApp via the Web Share API), all free.

---

## 3. Version 1 (after pilot; ≈8–10 weeks)

| Theme | Items |
|---|---|
| Reach | SMS provider adapter (PH gateway) with budget cap; web push (PWA) for participants; journal and prayer reminders; notification preferences & quiet hours; delivery log; OTP identification option |
| Care | Review delegation (leader on leave); leader encouragement notes to submitters; pastoral & leadership notes (**field-level encryption**); follow-up improvements |
| Insight | `journal_leader_daily_summary` rollups; monthly consistency, leader accountability, prayer attendance, devotional & worship participation reports; "groups to celebrate / may need encouragement"; scheduled weekly/monthly report emails; PDF export |
| Participants | Own last-7 journal history (device key); per-person timezone for members abroad; prayer self-sign-up; "pass the baton"; self-service unavailability |
| Security & privacy | **RLS** on content tables; step-up authentication; passkeys; retention purge jobs; data-subject export/anonymise tools; access-review report; custom roles editor |
| Operations | Merge UI; bulk QR card PDF; audit viewer; dark mode; **Filipino/Taglish localisation** |

## 4. Version 2
Attendance (QR check-in, reusing entry codes), Events & registrations (forms engine), Cell groups (meeting reports), Visitors & New Believers follow-up (care + forms), Discipleship/training tracks, Announcements, Viber/Messenger/WhatsApp providers, `/api/v1` REST + token auth as groundwork for a mobile app, analytics.

## 5. Future expansion
Native mobile app · Giving (separate compliance scope; use a dedicated payment/donation provider, not built in-house) · Counselling (highest sensitivity; separate encryption domain and permissions) · Ministry inventory · Generalised volunteer scheduling · Multi-campus · Multi-tenant SaaS (only if README decision D3 changes).

---

## 6. Risks & mitigations

| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| Low-tech members struggle with the form | Medium | High | Leader QR + remembered device; 18 px UI; pilot with older members; proxy submission fallback |
| Messy source spreadsheets | High | High | Import preview with explicit errors; staging dry runs; an admin data-cleanup week before rollout |
| Leaders don't review daily (review fatigue) | Medium | Medium | Fast review queue; "review expected" is a setting; digest instead of per-entry notifications |
| Privacy incident (content seen by the wrong person) | Low | **Severe** | Status/content separation; policy tests; access log; 2FA; break-glass; V1 RLS + encryption |
| SMS costs balloon | Medium | Medium | Free channels first; opt-in; daily cap |
| Scope creep before MVP stabilises | High | Medium | This roadmap; change requests go to V1/V2 unless they block the pilot |
| Single developer (bus factor) | Medium | High | Blueprint docs, ADRs, tests, conventional stack, no exotic infrastructure |
| Timezone/midnight bugs | Medium | Medium | Injectable clock; exhaustive boundary tests; ministry TZ in one place |
| Leaked leader QR | Medium | Low | Context-only codes; quarantine of registrations; one-tap rotation |

---

## 7. Quality & testing strategy

### Test layers
| Layer | Tooling | Focus |
|---|---|---|
| **Unit** | Vitest | Journal-date and late-window rules; timezone and midnight boundaries; phone normalisation; rrule expansion; rotation mapping; state machines (prayer, serving, requests); answer validation per field type; token generation/hashing; permission evaluation (`can`, `scopeFilter` SQL builders) |
| **Integration** | Vitest + **Testcontainers PostgreSQL** (real migrations) | Services against a real DB; every constraint (unique, partial unique, exclusion, CHECK) exercised; jobs run twice for idempotency |
| **Permission suite** | Vitest, generated from `catalog.ts` + fixture world | Every matrix cell × role × target class (in scope / sibling / ancestor / unrelated); out-of-scope → `NOT_FOUND`; list endpoints never leak rows; direct server-action invocation with forged ids |
| **Hierarchy property tests** | fast-check | Random trees (up to 5k nodes) and random move sequences. Invariants: closure == recursive CTE; no cycles; depth & primary leader correct; branch counts consistent |
| **Concurrency** | Integration | Parallel journal submits (same person/date) → exactly one entry; parallel moves → serialised, no corruption; parallel prayer assignment to the last capacity seat → one wins |
| **Public form E2E** | Playwright (Pixel 5 / iPhone SE emulation, slow-3G throttling) | First-time registration; returning via device key; new device via phone match; personal link install; leader QR incl. mismatch interstitial; double-tap send; network drop + retry; shared-phone mode; late window; retired code; JS disabled submission |
| **Portal E2E** | Playwright | Leader Today → review → follow-up; move with sub-tree; import; chain board resolve; roster publish → member accepts via link |
| **Scheduling suites** | Unit + integration | 24×1 h daily generation; 30-min vigil blocks; slot across midnight (chain date = start date); grace boundary (exactly `end + grace`); late completion; cross-chain overlap; substitute token revocation; commitment idempotency; weekly rotation across months; regeneration preserving manual edits; response lock time |
| **Accessibility** | axe-core in Playwright + manual (TalkBack, VoiceOver) | WCAG 2.2 AA; focus order; announced errors; 200% zoom |
| **Security** | OWASP ZAP baseline (CI vs staging); header assertions; dependency audit; secret scanning; targeted tests (CSRF cross-origin POST rejected, XSS payloads rendered inert in every text field, SQLi strings, rate limits, token expiry/reuse, cookie flags, session revocation) | Plus an **external penetration test before full rollout** (recommended) |
| **Performance** | k6 + a 50k-person synthetic dataset with 3 years of ledger | 50 submits/s for 10 min; 200 concurrent portal users; p95 targets from Phase 1; `EXPLAIN` plan snapshots for the 10 hottest queries (fail CI on sequential scans of large tables) |
| **Mobile UX research** | Pilot sessions with 5–8 real members (incl. older / low-tech) | Task success, time to submit, confusion points; fix before rollout |
| **Recovery** | Quarterly drill | Restore PITR backup to a scratch instance; verify integrity checks |

### CI gates (every pull request)
Typecheck → lint → unit → integration → permission suite → migrations apply cleanly to an empty DB and `drizzle-kit check` passes → build → E2E smoke (public journal + leader Today) → dependency audit.
Coverage thresholds: **policy layer and hierarchy service 100% lines/branches**; domain services ≥ 85%.

**Implementation note (2026-09-15).** `.github/workflows/ci.yml` runs three jobs on every push to `main` and every pull request:
1. Type-check, lint, Vitest and the production build.
2. Every migration applied twice to PostgreSQL 17 with Supabase's `anon` and `authenticated` roles, then row-level security and privilege checks and the reference-data seed.
3. The Playwright end-to-end tests.

Integration tests use PGlite rather than Testcontainers; job 2 covers the difference. Coverage thresholds, the generated permission suite, axe and ZAP are still to come.

### Definition of done (per feature)
Acceptance criteria met · permission rows covered by tests · loading/empty/error states implemented · mobile checked at 360 px · accessible (axe clean) · audit events emitted · no PII in logs · docs/ADR updated if a concept changed · migration reviewed as SQL.

---

## 8. Phase 8 kickoff plan (what I'll generate first, after your approval)

1. **Project scaffold**: package.json, TS config (strict), Next.js app structure per Phase 2 §2, Tailwind theme tokens, lint/format, Vitest/Playwright config, Dockerfile, docker-compose.yml, `.env.example`.
2. **Database foundation**: Drizzle schema for settings, people, hierarchy, ministries, IAM, audit; migrations `0000_extensions` → `0004_iam` (+ hand-written SQL for the `immutable_unaccent` function and partial/exclusion indexes); seed script (permissions, roles, leadership levels, designation types, serving roles, default journal form).
3. **Core server**: `RequestContext`, clock, policy catalog + `can`/`assertCan`/`scopeFilter`, audit writer, error/result types.
4. **Auth**: Better Auth config (magic link, TOTP), invitation flow, sessions.
5. **Hierarchy service + tests** (the first property-based test suite).

I'll tell you explicitly each time a **migration** must be run and each time a new **environment variable** is required.

### Environment variables (preview)
| Variable | Purpose | Needed from |
|---|---|---|
| `APP_URL` | Public base URL (links, QR) | M0 |
| `DATABASE_URL` | App login role (`app_rw`, a member of `gentouch_app`), pooled | M0 |
| `DATABASE_URL_MIGRATOR` | Migration role, direct connection | M0 |
| `BETTER_AUTH_SECRET`, `BETTER_AUTH_URL` | Auth signing / callback base | M0 |
| `EMAIL_PROVIDER`, `EMAIL_API_KEY`, `EMAIL_FROM` | Magic links, digests (`console` provider in dev) | M0 |
| `FORM_SESSION_SECRET` | Not needed. The form-session HMAC key is derived from `APP_ENCRYPTION_KEY`, which falls back to `BETTER_AUTH_SECRET` (docs/02 §4, M2 note) | — |
| `RATE_LIMIT_HMAC_SECRET` | Not needed. The rate-limit key is derived the same way | — |
| `TURNSTILE_SITE_KEY`, `TURNSTILE_SECRET_KEY` | Conditional bot challenge. Deferred: not required for M2 | Later |
| `SENTRY_DSN`, `NEXT_PUBLIC_SENTRY_DSN` | Error tracking on the server and in the browser (optional in dev) | M0; browser 2026-09 |
| `SENTRY_ORG`, `SENTRY_PROJECT`, `SENTRY_AUTH_TOKEN` | Source map upload in CI and Vercel builds | 2026-09 |
| `APP_ENCRYPTION_KEY` | Root key for app encryption and signing; defaults to `BETTER_AUTH_SECRET` | 2026-09 |
| `RATE_LIMIT_STORE`, `UPSTASH_REDIS_REST_URL`, `UPSTASH_REDIS_REST_TOKEN` | Rate-limit counters in Upstash Redis (production) | 2026-09 |
| `SCHEDULER_MODE`, `CRON_SECRET` | How background jobs run; the token Supabase Cron sends to `/api/cron/tick` | M3 |
| `EMAIL_OUTBOX_DIR` | Where `EMAIL_PROVIDER=file` writes messages (end-to-end tests) | 2026-09 |
| `SMS_PROVIDER`, `SMS_API_KEY` · `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY` · `FIELD_ENCRYPTION_KEYS` · `OBJECT_STORAGE_*` | V1 features | V1 |
