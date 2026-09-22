# Phase 2 — System Architecture

> Part of the **Ministry System — Product & Architecture Blueprint**. API contracts are in [02a-api-contracts.md](02a-api-contracts.md).

---

## 1. Recommended tech stack

Your preferred direction (Next.js + TypeScript + PostgreSQL) is **correct for this system**, and I recommend keeping it. I do recommend changing three pieces of the suggested stack and adding two that the brief left out:

| Layer | Choice | Why | Alternatives considered |
|---|---|---|---|
| Web framework | **Next.js (current stable, App Router) + React + TypeScript strict** | One codebase for the public mobile forms (server-rendered, little JS), the portal, and later an API for a mobile app. Server Components keep data access on the server | Separate SPA + API: more moving parts with no benefit at this size |
| Backend | **Modular monolith inside Next.js** + a **separate worker process** from the same codebase | Domain services live in `src/server/modules/*`, framework-agnostic, callable from server actions, route handlers and jobs. A separate NestJS backend isn't justified until there is a native mobile app *and* a separate team | NestJS/Fastify API: extract later if needed; the module boundaries make that mechanical |
| Database | **PostgreSQL 17+** (managed, with point-in-time recovery) | Relational integrity, recursive CTEs, partial/exclusion constraints, `pg_trgm` fuzzy search, partitioning, JSONB for answers | — |
| ORM / SQL | **Drizzle ORM + drizzle-kit** ⟵ *change from Prisma* | This system is SQL-heavy: closure-table maintenance, partial unique indexes ("one current leader"), exclusion constraints (no overlapping prayer slots), `ON CONFLICT` upserts for idempotent jobs, array snapshots with GIN indexes. Drizzle expresses these in typed TS or typed raw SQL, with no query-engine binary and readable SQL migrations | Prisma works, but these features would largely live in raw SQL outside its type system. If your team strongly prefers Prisma, it is viable, just with more hand-written SQL |
| Validation | **Zod** | Shared schemas for client forms, server actions, and job payloads | — |
| Auth | **Better Auth** (self-hosted library) ⟵ *specific recommendation* | Sessions stored in our Postgres (revocable); magic link, TOTP 2FA, passkeys, rate limiting and a Drizzle adapter out of the box. Pastoral data never touches a third-party identity vendor | Auth.js (weaker 2FA/passkey story); Clerk/Auth0 (good, but an external processor of sensitive-org user data plus per-user cost) |
| Background jobs | **Graphile Worker** (Postgres-backed queue + cron) ⟵ *addition* | No Redis needed. Jobs can be enqueued **inside the same DB transaction** as the business write (a free transactional outbox). Cron with backfill after downtime, and `job_key` de-duplication, support idempotency | pg-boss (equivalent); BullMQ (needs Redis); Vercel Cron (no long-running worker) |
| UI | **Tailwind CSS v4** + **Radix UI primitives** (shadcn/ui-style copied components, **custom-themed**) + **TanStack Table** (headless) + **lucide** icons | Accessible primitives without the generic "admin template" look; we own the design system | MUI/Chakra (heavier, recognisable look) |
| Charts | Minimal: **visx** or hand-rolled SVG sparklines/bars | Few charts, calm styling, small bundle | Heavy chart suites |
| Recurrence | **rrule** (RFC 5545) | Standard recurrence strings for prayer and devotional schedules | Custom recurrence DSL |
| QR | **qrcode** (server-side SVG/PNG) | No third-party QR service sees our URLs | — |
| Notifications | Adapters: Email (**Resend / Postmark / Amazon SES**), SMS (**Semaphore** (PH) / Twilio), Web Push (**VAPID / web-push**), later Viber / Messenger / WhatsApp | Provider-agnostic interface (§6) | — |
| Edge / security | **Cloudflare** in front: TLS, WAF, rate-limiting rules, **Turnstile** (privacy-friendly CAPTCHA, only when needed), DDoS protection | Public forms need bot protection without annoying real people | reCAPTCHA (more intrusive, privacy concerns) |
| Observability | **Sentry** (errors, with PII scrubbing), **pino** structured logs, uptime monitor, job-failure alerts | — | — |
| Testing | **Vitest**, **Testcontainers** (real Postgres in integration tests), **Playwright** (mobile emulation, slow network), **axe-core**, **k6** (load), **OWASP ZAP** baseline | — | — |
| Packaging | **Docker** image with two entrypoints: `web` and `worker`; **pnpm** | Portable across hosts; no vendor lock-in | — |

> **Stack alignment (2026-09-15).** The ministry approved a stack for building and deploying the system. The code follows it now, without rewriting M1–M2. Where it differs from the table above:
> - **Hosting:** Vercel, with PostgreSQL on **Supabase (Singapore)**, Cloudflare DNS, and GitHub with GitHub Actions. There is no separate worker process: background jobs run inside the app, and **Supabase Cron** triggers them every minute (§7 note). The "not Vercel-only" advice below therefore no longer applies.
> - **Background jobs:** an in-app scheduler with leases replaces Graphile Worker, which needs a network PostgreSQL connection and so can't use the embedded development database. Supabase Queues can take over notification delivery if volume ever needs it.
> - **Auth:** Better Auth stays for now. **Supabase Auth** is the approved target; the move needs a Supabase project. The encryption root key is already separate from the auth secret (`APP_ENCRYPTION_KEY`).
> - **UI:** **shadcn/ui** components copied into `src/components/ui` and mapped onto the brand tokens. **React Hook Form** with Zod for multi-field forms (`src/components/forms/use-action-form.ts`). **TanStack Table** v9 for tables sorted in the browser. **Recharts** through the shadcn chart, instead of visx. M1–M2 screens keep their current pattern until a planned conversion pass.
> - **Rate limiting:** **Upstash Redis** in production (`RATE_LIMIT_STORE=upstash`); the PostgreSQL table in development and tests. Turnstile only when needed.
> - **Observability:** **Sentry** (errors only, personal data scrubbed) and structured JSON logs from `src/server/logger.ts`, instead of pino.
> - **Testing:** Vitest on PGlite; a CI job that applies every migration to real PostgreSQL 17 with Supabase's roles; **Playwright** end-to-end tests.
> - **Runtime and tooling:** Node.js 24 LTS; npm rather than pnpm.

**A note on Laravel/Django.** Both are also excellent for admin-heavy CRUD systems (Django Admin in particular). If your developers are PHP or Python people, either would be a valid choice. I recommend the TypeScript stack because one language covers public forms, portal, worker and a future React Native app, and because you asked for it.

### Hosting recommendation
```
Cloudflare (DNS, TLS, WAF, rate limits, Turnstile)
        │
        ▼
Container platform in SINGAPORE region (closest major region to PH, ~30–50 ms)
   ├─ web     (Next.js, 2+ instances, autoscale on CPU)
   └─ worker  (Graphile Worker, 1 instance; 2 later — safe, jobs are locked)
        │
        ▼
Managed PostgreSQL (Singapore) — PITR backups, connection pooler, encrypted at rest
        │
Object storage (Cloudflare R2 / S3) — V1+, for exports and attachments only
```
Suitable platforms include Railway, Render, Fly.io, AWS (ECS + RDS), and DigitalOcean App Platform + Managed PG; the choice is a cost/ops preference (README decision D5). **I don't recommend Vercel-only**: the worker needs a long-running process, and splitting web and worker across vendors adds complexity with nothing gained at this size.

Environments: `development` (Docker Compose Postgres), `staging` (production-like, anonymised seed data), `production`.

---

## 2. High-level architecture

```
┌──────────────────────── Clients ─────────────────────────┐
│  Public mobile web (PWA)          Portal (desktop/tablet/phone)
│  /j  /j/{code}  /pray/{code}      /app/…  (login)
│  /a/{token}  /k/{token}                                   │
└───────────────┬───────────────────────────┬──────────────┘
                │ HTTPS                     │
        ┌───────▼───────────────────────────▼────────┐
        │              Cloudflare edge                │
        │  WAF · rate limits · Turnstile · caching    │
        └───────────────────────┬─────────────────────┘
                                │
┌───────────────────────────────▼──────────────────────────────────┐
│                    Next.js "web" process                          │
│  ┌──────────────┐  ┌──────────────┐  ┌────────────────────────┐   │
│  │ Public routes │  │ Portal routes │  │ Route handlers         │   │
│  │ (RSC + server │  │ (RSC + server │  │ /api/auth/* /api/public│   │
│  │  actions)     │  │  actions)     │  │ /api/qr /api/export    │   │
│  └──────┬───────┘  └──────┬───────┘  │ /api/webhooks /health  │   │
│         └────────┬────────┘          └───────────┬────────────┘   │
│                  ▼                               ▼                │
│   ┌──────────────────────── Application layer ─────────────────┐  │
│   │  Request context (actor, scopes, request id, participant)  │  │
│   │  Policy layer  (can / assertCan / scopeFilter)             │  │
│   │  Domain modules (services + repositories + validators)     │  │
│   │  people · hierarchy · ministries · forms · journal ·       │  │
│   │  prayer · devotional · scheduling · care · notifications · │  │
│   │  links(qr/tokens) · reports · audit · settings · import ·  │  │
│   │  iam                                                        │  │
│   └───────────────────────────┬────────────────────────────────┘  │
└───────────────────────────────┼───────────────────────────────────┘
                                │ SQL (pooled)
                    ┌───────────▼────────────┐
                    │      PostgreSQL        │◄──── Graphile Worker jobs table
                    │ domain tables · ledger │      (enqueued in the same tx)
                    │ closure · audit        │
                    └───────────▲────────────┘
                                │
┌───────────────────────────────┴───────────────────────────────────┐
│                     "worker" process (same codebase)               │
│   Cron: journal open/close day · reminders · slot generation ·     │
│   overdue checks · rollups · retention · integrity checks          │
│   Queues: notification delivery · exports · imports                │
│         └──► Provider adapters: Email · SMS · Push · (Viber/WA)    │
└────────────────────────────────────────────────────────────────────┘
```

### Module rules (these keep the monolith from turning into spaghetti)
1. **UI never touches the database.** Components call server actions or load through module query functions.
2. **Every module exposes a service API** (`journal.service.ts`) and owns its tables. Other modules call that API. They do not query another module's tables directly, except for read-only reporting views in `reports`.
3. **Every service call receives a `RequestContext`** (actor, scopes, participant identity, request id, clock). There are no hidden globals, and the clock is injectable for tests.
4. **Authorisation happens in services, not only in pages.** Pages hide what you can't do; services refuse it.
5. **Side effects are recorded as jobs** (notifications, recalculations) enqueued in the same transaction, so there are no lost or phantom notifications.
6. **Framework-agnostic core.** `src/server/modules/**` imports nothing from `next/*`, so it can move to a standalone API later.

### Proposed repository structure
```
/                                  (single package, pnpm)
├─ docs/                           this blueprint
├─ drizzle/                        generated + hand-written SQL migrations
├─ src/
│  ├─ app/
│  │  ├─ (public)/                 j/, j/[code]/, k/[token]/, pray/[code]/, a/[token]/, privacy/
│  │  ├─ (portal)/app/             dashboard, people, leadership, journal, prayer, devotional, ministries,
│  │  │                            reports, notifications, admin/users, admin/settings, admin/audit
│  │  ├─ api/                      auth/[...all], public/leaders, qr/[id], export/[report], webhooks/*, health
│  │  └─ layout.tsx
│  ├─ components/
│  │  ├─ ui/                       design-system primitives (Button, Field, Sheet, DataTable, StatusChip…)
│  │  ├─ public/                   mobile form components
│  │  └─ portal/                   shell, nav, scope switcher, page headers
│  ├─ server/
│  │  ├─ db/                       client, schema/*.ts (one file per module), sql helpers
│  │  ├─ context/                  RequestContext, participant resolution, clock
│  │  ├─ policy/                   permission catalog, scope resolution, can()/assertCan()/scopeFilter()
│  │  ├─ modules/
│  │  │  ├─ people/                people.service.ts, people.repo.ts, people.schemas.ts, dedupe.ts
│  │  │  ├─ hierarchy/             hierarchy.service.ts (move/closure), hierarchy.queries.ts
│  │  │  ├─ journal/               submit.ts, ledger.ts, review.ts, policy.ts, schemas.ts
│  │  │  ├─ prayer/ devotional/ forms/ care/ notifications/ links/ reports/ audit/ settings/ import/ iam/
│  │  ├─ jobs/                     worker entry, crontab, task handlers (thin → call services)
│  │  └─ notifications/providers/  email/, sms/, push/ adapters
│  ├─ lib/                         pure utilities (phone, dates/tz, ids, tokens, rrule helpers)
│  └─ styles/
├─ tests/                          integration/, e2e/, security/, fixtures/
├─ Dockerfile · docker-compose.yml · .env.example
```

---

## 3. Authentication architecture

### Portal users
| Aspect | Design |
|---|---|
| Provisioning | **Invitation only.** Admin creates or links a person → "Invite to portal" → email magic link → first sign-in → 2FA setup if the role requires it. No public sign-up |
| Methods | Email **magic link** (primary; ideal for non-technical leaders); optional password; optional Google sign-in; **TOTP 2FA** mandatory for any role holding a permission marked `sensitive` (journal content, pastoral notes, user management, exports, settings); passkeys (V1). **Implementation note (M0):** the second factor is enforced by our own TOTP service, per session (`auth_sessions.two_factor_verified_at`). Better Auth's 2FA plugin only challenges password sign-ins, so a magic-link login would bypass it. Users who have 2FA can't enter the portal until the session is verified, and sensitive permissions stay locked until 2FA is set up |
| Sessions | Database-backed (revocable), opaque token in a `__Host-` prefixed cookie: `HttpOnly; Secure; SameSite=Lax; Path=/` |
| Session lifetime | Leader-only roles: 30-day rolling on a trusted device (so it *feels* like no login on their phone). Sensitive roles: 12 h absolute, 60 min idle |
| Step-up | Re-authentication (≤ 10 min old) for: role/permission changes, exports containing personal data, viewing confidential answers in bulk, settings changes (V1) |
| Brute-force | Per-IP and per-email rate limits on sign-in and magic-link requests; generic responses ("If this email has access, a link is on its way"); magic links single-use, 15-min expiry |
| Account ↔ person | `users.person_id` (unique). A user's branch scope is anchored on their own person node |
| Offboarding | Deactivating a user revokes all sessions immediately. Deactivating a *person* who has a user account prompts to deactivate that account too |

### Participants (no login)
Participants are **not users**. They carry a *participant identity* resolved per request:

| Mechanism | What it is | Storage |
|---|---|---|
| **Device key** | Random 256-bit secret issued after successful identification or registration, unless "This isn't my phone" is ticked | Cookie `__Host-gt_pk` (HttpOnly, Secure, SameSite=Lax, 1-year). DB stores only the SHA-256 hash (`participant_keys`) + a device hint. Revocable per device |
| **Personal link** | `/k/{token}`: a one-time link a leader can send (Messenger/Viber/SMS/email) to restore recognition on a new phone | `action_tokens` (hashed), 7-day expiry, single use; exchanging it sets the device key and **redirects to a clean URL** (the token never stays in the address bar or history) |
| **Action link** | `/a/{token}` for one assignment (prayer slot, serving assignment) | `action_tokens` (hashed), bound to person + assignment, expires after the assignment window |
| **Phone + first name** | Fallback identification on a new device; can be disabled in settings | Rate-limited; see §4 |

The participant context grants **write-only** capabilities to one person's own records (submit their journal, respond to their own assignments) and **no read access to history** (V1 adds the last 7 of their own entries, device key only).

---

## 4. Public form architecture

### Routes
| Route | Purpose |
|---|---|
| `/j` | General daily journal |
| `/j/{leaderCode}` | Leader-specific journal (leader preselected). `/journal?leader=CODE` redirects here |
| `/k/{token}` | Install personal key → sets cookie → redirects to `/j` |
| `/pray/{chainCode}` | Prayer chain page: your next slot and actions; today's coverage (first names only, if the chain allows) |
| `/a/{token}` | Action page for a specific prayer or serving assignment |
| `/privacy` | Privacy notice (versioned) |

### Rendering & payload discipline
- Server-rendered (RSC) pages; forms are **server actions with progressive enhancement**, so submission works even before JS hydrates.
- JS budget ≤ 90 KB for public routes: no chart libraries, no portal components, fonts subset and preloaded.
- A PWA manifest makes the journal installable ("Add to home screen" prompt after the 2nd successful submission). Home-screen name **GenTouch**, icon = the simplified flat GenTouch mark (Phase 4 §2 Brand). The service worker caches **static assets only**, never personal data.

### Identification ladder (journal)
```
Request arrives at /j or /j/{code}
  │
  ├─ device key cookie valid? ──yes──► "Good morning, John" + leader shown → FORM
  │
  ├─ no ──► "Have you journaled with us before?"
  │          ├─ Yes → enter mobile + first name
  │          │     ├─ exactly one active match → issue device key (unless shared phone) → FORM
  │          │     ├─ several matches (shared phone, same first name) → "Ask your leader for your personal link"
  │          │     └─ no match → generic "We couldn't confirm those details" → offer register / retry
  │          │         (same response time & shape as a match failure: no enumeration oracle)
  │          └─ No / first time → REGISTER (name, mobile, leader [preselected on leader QR],
  │                ministry if required, consent, guardian consent if minor) → Turnstile if risk signals
  │                → person created as UNCONFIRMED under the chosen leader → device key → FORM
  └─ (V1) OTP via SMS as an alternative to first-name confirmation when SMS is configured
```
**Rules:** no stored personal data is ever rendered before identification. After identification, only the preferred first name and the current leader's display name are shown. Journal history is never shown on a new device.

### Anti-abuse layers (cheapest first)
1. Cloudflare rate-limit rules on `/j*`, `/pray*`, `/a/*`, `/api/public/*`.
2. App rate limits (Postgres `UNLOGGED` token-bucket table; swap to Redis/Upstash if ever needed):
   - identification: 5 attempts / 15 min per IP **and** per phone number
   - registration: 10 / hour per IP, 3 / day per device
   - submission: 10 / min per device key
   - leader search: 30 / min per form session
3. **Form session token**: signed (HMAC) and short-lived (2 h), issued on page load and required by actions and the leader-search endpoint (stops blind scripted posting and standalone scraping).
4. Honeypot field + minimum fill time (≥ 3 s).
5. **Turnstile** only when risk signals appear: registration from a leaked code, high volume from one IP, a failed honeypot. Returning, recognised people never see a CAPTCHA.
6. **Quarantine by design**: registrations are Unconfirmed until the leader confirms, so spam can't pollute counts or the directory.
7. Payload limits (answers ≤ 10 KB per field, ≤ 50 KB per submission); Zod validation server-side; plain text only (no HTML accepted).

### Resilience on poor networks
- Answers are held in component state and mirrored to `sessionStorage` (never `localStorage`, and not at all in shared-phone mode), then cleared on success.
- Each submit carries a client-generated **idempotency key** (UUID). Retries after a timeout return the original result (exactly-once entry).
- The success screen is rendered from the server response and shows the date and time received, so there's no doubt it arrived.

**Implementation notes (M2, 2026-09-15).** These record how the public journal was built. The concepts above are unchanged.
- **Client app, not server actions.** `/j` and `/j/{code}` are a small client app over JSON route handlers (`/api/public/*`, see docs/02a §2). The flow is easier to test end to end over HTTP, and the page keeps answers in memory across retries. The trade-off is that the journal page needs JavaScript.
- **Drafts.** Drafts are mirrored to `localStorage` only on remembered devices, never in "This isn't my phone" mode. They are cleared on success, so an accidentally closed tab doesn't lose a reflection.
- **Device-key cookie.** It is named `gt_pk` in development (plain HTTP) and `__Host-gt_pk` in production. Remembered keys roll forward to one year on use. "This isn't my phone" issues a 2-hour key in a browser-session cookie; that key can't edit or read back a journal.
- **Form session and rate limits.** The form session token lives 6 hours, with a minimum fill time of 2 s (4 s for registration). Its HMAC key and the rate-limit key are derived from `BETTER_AUTH_SECRET` (HKDF), so no new environment variables are needed. Leader search is limited per IP (60/min) instead of per form session.
- **Turnstile deferred.** The honeypot, fill time, rate limits and unconfirmed-by-default registration cover the MVP.
- **Phone + first name matching.** The match is exact, never fuzzy. It is accent- and case-insensitive and accepts the first name or the preferred name.
- **Public leader search.** Results show first name and last initial only, with the primary leader's first name as a hint.
- **Retired entry codes.** A retired code never reveals its replacement, so a leaked code simply stops preselecting a leader.
- **Personal links.** `/k/{token}` renders a confirmation page, so chat-app link previews can't use up the link. Its button POSTs the token, and the page sends `Referrer-Policy: no-referrer`.
- **Different leader's QR code.** Suppose an identified person journals through another leader's QR code and confirms "this is my leader now". That creates a pending leader-change request, never a direct move.

**Implementation note (2026-09-21): journal proof photos.** Members photograph the notebook they wrote in and send it with their journal. The rule is one setting, `journal.policy.proofImage` — `required`, `optional` or `off` — so the ministry can change its mind in Settings → Daily Journal without a deploy. It ships as **required**.

- **The bytes are never trusted.** The photo is decoded on the server (`src/server/modules/journal/proof.service.ts`), which is what proves it really is a JPEG, PNG or WebP whatever the filename says, then rotated by its EXIF orientation, resized to 2000 px on the long side and re-encoded as WebP. Re-encoding drops EXIF, so no GPS coordinates or device names are ever stored. A "small" file that decodes to a huge canvas is refused by a pixel limit.
- **It goes through our server, not straight to storage.** Vercel refuses a request body over 4.5 MB, so the page shrinks the photo on the phone first (usually to a few hundred KB) and posts it to `/api/public/journal/proof`. The alternative — a signed upload URL straight to Supabase — would let unchecked bytes land in the bucket and would have to be downloaded, sniffed and rewritten afterwards anyway, so this is both simpler and safer. The service-role key never leaves the server.
- **Sent, then attached.** An upload is stored as `pending` and belongs to no journal. The journal's own transaction attaches it, so a journal is never recorded as complete with its required photo missing. Anything still `pending` after a day is deleted by the `journal.proof_cleanup` job, as are photos an administrator removes.
- **Private, and only ever briefly.** The bucket is private; a viewer gets a link that stops working after a minute, made only after the policy layer agrees. Nothing public or permanent is ever stored in the database — only where the file is and what it is.
- **Who may look** is `journal.proof.view`, separate from reading the typed answers (docs/06 rows 15a–15b, note m). Removing a photo is `journal.proof.manage`, which is pastoral and global.
- **Journals recorded by a leader over the phone** (`journal.proxy_submit`) are not asked for a photo: the person is not holding the notebook.
**Implementation note (2026-09-23): prayer report photos.** Someone who finishes an hour of prayer may send a picture from that time with their report. It is the same pipeline as the journal's proof photo — one module now (`src/server/storage/images.ts`) serving both — with the same limits, the same decoding to prove what the bytes are, the same re-encode to WebP that drops EXIF, the same private bucket under `prayer-report/{personId}/{date}/{id}.webp`, and the same minute-long signed links.

- **Each chain decides** whether to ask for one: `prayer_chains.report_photo` is `required`, `optional` (the default) or `off`. Required means a report must carry one; nobody is stopped from sharing a testimony because they had nothing to photograph at three in the morning.
- **Its own row, its own key.** `prayer_report_attachments` points at the `form_responses` row the report is, not at a table of its own — the report stays a versioned form with its answers split by sensitivity, which is what keeps a prayer request from a leader. The photo is `pending` until the report's transaction attaches it, and the hourly `prayer.report_photo_cleanup` job deletes what was never used.
- **Who may look** is `prayer.report.attachment.view`, separate from reading the words (docs/06 note n). It is pastoral, so a prayer chain coordinator runs the chain and reads the testimony without it. An anonymous report hides its photo exactly as it hides its author.

- **Storage drivers** follow the same shape as the email providers: `STORAGE_DRIVER=local` writes to a directory in development and tests, `supabase` uses the private bucket in production. Local links are served by `/api/journal/proof/file`, which checks the same signature and expiry Supabase would, so development behaves like production instead of pretending files are public.

---

## 5. QR architecture

Three separate kinds of public identifier, deliberately kept apart:

| Kind | Table | Secret? | Example | Grants | Lifetime |
|---|---|---|---|---|---|
| **Entry code** | `entry_codes` | No: meant to be printed and shared | `/j/K7M3QX9A` | Only *context* (which leader or chain to preselect). No data access | Until rotated |
| **Action token** | `action_tokens` | **Yes** | `/a/3fK…(43 chars)` | One person's actions on one assignment, or personal-key installation | Expires (assignment end + grace, or 7 days for personal links) |
| **Device key** | `participant_keys` | **Yes** (cookie only, never in URLs) | — | The participant's identity on that device | 1 year, revocable |

**Design details**
- Entry codes: 8 characters from Crockford base32 (no ambiguous 0/O, 1/I/L), ~40 bits, random, case-insensitive, **not** derived from IDs. One active journal code per leader (partial unique index). **Rotation** retires the old code: scanning it shows "This QR code has been replaced. Please ask your leader for the new one" (optionally redirecting during a grace period).
- Action tokens: 256-bit random, URL-safe base64. **Only the SHA-256 hash is stored.** Constant-time comparison happens implicitly through the hash lookup. Tokens are bound to `(purpose, person_id, subject_id)`, and use counts are capped per purpose.
- QR images are rendered on demand (`/api/qr/{entryCodeId}`, authorised) as SVG/PNG with error-correction level M and short URLs, so the QR stays low-density and scans on cheap cameras. Print layouts: wallet card, A6 table tent, A4 poster. The GenTouch logo goes **beside** the code, not inside it, which keeps level-M density. An optional centred mark is supported but switches the code to error-correction level H.
- `Referrer-Policy: no-referrer` and `Cache-Control: no-store` on all token routes. Token routes are excluded from analytics and error-tracking breadcrumbs.
- Scan counting per entry code (count + last scanned), no IP retention.

**Implementation note (M2).** The printable card is a portal page, `/app/people/{id}/qr`. It renders the QR code on the server as inline SVG (error-correction level M, near-black on white), with the GenTouch mark above the code rather than inside it. A separate `/api/qr/{id}` endpoint and the table-tent and poster layouts are deferred; the single card prints cleanly from the browser.

---

## 6. Notification architecture

```
Domain event (e.g. PrayerSlotStartingSoon)
   │  (job enqueued in the business transaction)
   ▼
Notification intent  ── notifications row: category, recipient, payload (non-sensitive),
   │                    dedupe_key UNIQUE, scheduled_for
   ▼
Policy & preference resolution
   │  opt-in/opt-out per category & channel · quiet hours · SMS daily budget cap ·
   │  archived/deceased suppression · channel priority & fallback
   ▼
Rendering  ── notification_templates (key × channel × locale × version), {{placeholders}}
   ▼
Delivery job per channel  ── notification_deliveries row (masked destination, status, attempts)
   ▼
Provider adapter  implements  NotificationProvider {
                                channel: 'email'|'sms'|'push'|'in_app'|'viber'|'whatsapp'
                                send(message): Promise<DeliveryResult>
                                parseWebhook?(req): DeliveryStatusUpdate[]
                              }
   ▼
Provider webhooks → /api/webhooks/{provider} (signature-verified) → delivery status updates
```

- **Idempotency:** `dedupe_key` such as `journal_reminder:{personId}:{date}` or `prayer_slot_reminder:{assignmentId}:30m`. Inserting with `ON CONFLICT DO NOTHING` makes every reminder job safe to re-run.
- **Retries:** exponential backoff (1 m, 5 m, 30 m, 2 h), max 4 attempts; permanent failures (invalid number, bounced) mark the contact point.
- **No sensitive content in notifications.** Messages say "Your leader left you a note", not the note. SMS and push previews are visible on lock screens.
- **Cost control (important in PH):** an SMS costs very roughly ₱0.35–₱1 per segment through local gateways (verify current pricing). One daily reminder to ~1,900 people works out to around ₱20k–₱55k per month. Defaults are therefore: reminders only to people *not yet submitted*, only if they opted in, free channels first (web push, email, in-app), and a **daily SMS cap** in settings.
- **MVP channels:** in-app (portal), email (magic links, leader digests, assignment links), and **"Share" buttons** (Web Share API → Messenger/Viber/WhatsApp) so coordinators can send personal links at zero cost. SMS and web push arrive in V1 without any change to the core.

---

## 7. Background-job architecture

**Runtime:** Graphile Worker in the `worker` process. Cron entries run in the ministry timezone. Every job takes an explicit **business date or time window as a parameter** (never "now" implicitly), so it can be re-run or backfilled safely.

| Job | Schedule (default) | What it does | Idempotency |
|---|---|---|---|
| `journal.open_day` | 00:05 daily | Insert ledger rows (`journal_days`) for every expected person for *D* with hierarchy snapshot; rest days/pauses → Excused | `UNIQUE(person_id, journal_date)` + `ON CONFLICT DO NOTHING` |
| `journal.resync_day` | on hierarchy change / expectation change (queued) | Refresh snapshots and expectation for unfinalised rows | Deterministic recompute |
| `journal.close_day` | at late cutoff (09:00 D+1) | Not yet → **Missed**; set `finalized_at`; compute streaks; create follow-up suggestions at threshold | Only touches `finalized_at IS NULL`; follow-up `dedupe_key` |
| `journal.reminders` | configurable (e.g. 19:00) | Enqueue reminders for opted-in, not-yet-submitted people | `dedupe_key` per person/day |
| `journal.leader_digest` | configurable (e.g. 20:00 / 07:00) | Leaders: "9 of 12 have journaled; 3 not yet" (status only) | `dedupe_key` per leader/day |
| `prayer.generate_slots` | 01:00 daily | Materialise slots N days ahead from schedules; apply recurring commitments | `UNIQUE(chain_id, starts_at)`; assignments `ON CONFLICT` |
| `prayer.slot_reminders` | every 5 min | Reminders at T−24 h (confirm) and T−30 min (start) | `dedupe_key` per assignment/offset |
| `prayer.check_overdue` | every 5 min | End + grace passed without completion → **Needs follow-up** + care item + coordinator notice | Status transition guarded by current status |
| `devotional.generate_gatherings` | 01:30 daily | Materialise gatherings and rosters for the rolling window (rotation) | `UNIQUE(schedule_id, occurs_on)`; never overwrites manual edits |
| `devotional.confirmation_reminders` | 08:00 daily | Pending assignments at T−72 h / T−24 h | `dedupe_key` |
| `rollups.journal_daily` (V1) | after `close_day` | Upsert per-leader daily summary rows | `UPSERT` on `(journal_date, leader_person_id)` |
| `reports.weekly` / `reports.monthly` (V1) | Mon 06:00 / 1st 06:00 | Generate and email scoped summaries | `dedupe_key` per period/recipient |
| `hierarchy.verify` | 03:00 daily | Recompute the closure from adjacency in a temp table and diff; alert on mismatch (should never happen) | Read-only |
| `retention.purge` (V1) | Sun 02:00 | Apply retention policies (content purge, IP/UA nulling in audit after 90 days) | Deterministic criteria |
| `tokens.cleanup` | 04:00 daily | Delete expired action tokens and old rate-limit buckets | — |
| Queues: `notify.deliver`, `export.generate`, `import.process` | on demand | — | Job keys |

**Operational rules:** a failed job retries with backoff. After final failure it lands in a visible "failed jobs" list in Settings → System health and alerts the Super Admin. Cron backfill (e.g. 6 h) means a worker restart at 00:03 still opens the day.

**Implementation note (M2).** There is no worker process yet; Graphile Worker arrives with M3. Until then the journal ledger is maintained on demand. `ensureJournalLedger(now)` runs at the start of every journal read and submission, under advisory lock 7301, and does three things:
- **Opens** today, catching up on up to 14 missed days.
- **Re-syncs** open days flagged by structural changes (`journal_ledger_runs.needs_resync`). Hierarchy moves, changes to a person's status or expectation, confirmations, pauses and rest days all set the flag.
- **Closes** days past the late cutoff: marks them Missed, computes streaks and raises follow-ups.

It is idempotent and cheap when there is nothing to do, and the M3 worker will call the same functions on the schedule above. Two limits apply until then: a day nobody opens is closed on the next visit, and reminders and leader digests are not sent.

**Implementation note (M3 and stack alignment, 2026-09-15): an in-app scheduler instead of Graphile Worker.**
- **Why:** Graphile Worker needs a network PostgreSQL connection, so it can't run against the embedded development database, and Vercel has no long-running worker process.
- **How jobs run:** `runDueJobs` (`src/server/modules/scheduler/scheduler.service.ts`) claims each due job with a lease in `scheduled_jobs`, in a single `UPDATE`. Overlapping ticks from several server instances therefore never run the same job twice. Jobs are idempotent and work from the tick time, so a repeated or missed tick is harmless.
- **What triggers them:**
  - `SCHEDULER_MODE=in_process`: a one-minute timer inside the server (development, or one long-running server).
  - `SCHEDULER_MODE=external` (Vercel): **Supabase Cron** calls `POST /api/cron/tick` every minute with `Authorization: Bearer <CRON_SECRET>`. Set it up with `deploy/supabase-cron.sql`.
- **Jobs so far** (`src/server/modules/scheduler/jobs.ts`) run on intervals rather than at wall-clock times:
  - `journal.ledger` every 5 minutes: the open, resync and close steps above. Days now close on time even when nobody visits; the calls on each journal request remain.
  - `prayer.generate_slots` hourly.
  - `prayer.check_overdue` every 5 minutes: once the grace time has passed, a slot nobody marked finished becomes `needs_follow_up`, a care follow-up opens, and the chain's coordinators get an in-app notice.
  - `prayer.slot_reminders` every 5 minutes: a reminder 24 hours before a slot (for assignments made at least 20 hours ahead) and 30 minutes before (made at least 40 minutes ahead), each sent at most once per assignment.
  - `devotional.generate_gatherings` hourly (M4): each active schedule's missing gatherings in its window, with their rosters filled. A gathering that already exists is never changed.
  - `devotional.confirmation_reminders` every 15 minutes (M4), for people on published rosters who haven't replied:
    - A reminder 72 hours before, if they were told at least 84 hours before.
    - Another 24 hours before, if they were told at least 30 hours before.
    - Coordinators get an in-app notice about required roles still open within 24 hours.
  - `tokens.cleanup` daily.
  - `notifications.deliver` every minute.
  - Journal reminders and leader digests come later.
- **Failures:** a failed job is retried after 5 minutes. Its last error is stored without personal data (`errorSummary` in `src/server/logger.ts`) for Settings → System health.
- **Alerts (M5.2):**
  - A failure also sends the `system.job_failed` notice to every holder of a global `settings.manage` (active or invited), in the inbox and by email.
  - It goes out at most once per job per person per day, with the job's name and the error summary.
  - System health (`/app/admin/health`) also warns when no job has started for 15 minutes.

---

## 8. Security architecture

### 8.1 Threat → control map
| Threat | Controls |
|---|---|
| **SQL injection** | Drizzle parameterised queries only; raw SQL only through the `sql` tagged template (auto-parameterised); lint rule bans `sql.raw` outside migrations; DB app role has no DDL rights |
| **XSS** | React escaping; **no** `dangerouslySetInnerHTML`; journal/prayer text stored and rendered as plain text (line breaks preserved via CSS); strict **CSP with nonces**; `X-Content-Type-Options: nosniff` |
| **CSRF** | Server actions check `Origin`; `SameSite=Lax` cookies; route-handler mutations require the `Origin` check + form session token; no state-changing GETs (token pages show a confirm *button*, and actions happen on POST, which also defeats link-preview bots that pre-fetch URLs) |
| **IDOR / broken authorisation** | UUIDv7 IDs (non-guessable) **and** policy checks on every load: `assertCan(ctx, 'journal.content.view', entry)`; list queries built through `scopeFilter(ctx, …)` so out-of-scope rows are never selected; out-of-scope → 404; automated permission test matrix (Phase 7) |
| **Privilege escalation** | Only holders of `iam.roles.manage` can assign roles, and **only roles whose permissions they themselves hold**, within scopes they hold; changes need 2FA + step-up; every change audited and notified to other Super Admins |
| **Spam / bots on public forms** | §4 layers: edge + app rate limits, form session token, honeypot, timing, conditional Turnstile, quarantine of new registrations |
| **QR link abuse** | Entry codes grant context only; rotation; scan anomaly alerts; action tokens secret, hashed, scoped, expiring |
| **Duplicate submissions** | Unique constraints + idempotency keys + controlled edit flow |
| **Brute force** | Auth rate limits (Better Auth + app buckets); identification attempt limits per phone and IP; lockout backoff with generic messages |
| **Session hijacking** | `__Host-` HttpOnly Secure cookies; HSTS (preload); session rotation on login and privilege change; revoke-all; IP/UA recorded on the session for user review |
| **Sensitive data leakage** | Status and content in **separate tables** (dashboards physically never join content); field sensitivity tiers; PII-scrubbing in logs and Sentry; notifications carry no content; exports audited; `Cache-Control: no-store` on portal and token pages |
| **Enumeration** | Uniform identification responses; leader search limited in fields and results; no sequential public IDs |
| **Supply chain** | Lockfile, Renovate/Dependabot, `pnpm audit` in CI, minimal dependencies on public routes |
| **Insider misuse** | Least privilege, access log of sensitive reads, break-glass access with a stated reason (notifies pastors), periodic access review report |

**Implementation note (M5.3, 2026-09-17): sign-in rate limits.**
- **The actual limits:** besides the configured `rateLimit` (60 requests a minute per IP, `src/server/auth/config.ts`), Better Auth 1.7's magic-link plugin allows 5 requests per IP to `/sign-in/magic-link`, and 5 to `/magic-link/verify`. Each allowed request restarts a one-minute clock, so the count clears only after a quiet minute.
- **How the E2E suite found it:** every test runs from one address, and the suite signed in often enough to be refused. Tests not about signing in now share one session (`tests/e2e/support/fixtures.ts`).
- **Pilot risk (docs/07, known M5 issues):** people on one connection share the budget, such as a church Wi-Fi or a mobile carrier's shared address.
- **Production storage:** counts are kept in memory by default, which on Vercel means per instance.
- **Proposed for 5.6:** raise the per-IP limit for these two routes, add a per-email limit in the app, and keep the counts in Upstash Redis.

**Implementation note (M5.6, 2026-09-18): sign-in rate limits, as built.** The ministry approved the change above. `src/server/auth/rate-limit.ts` holds all three parts, and `tests/integration/auth.test.ts` covers them.

| | Before | Now |
|---|---|---|
| Per IP, `/sign-in/magic-link` and `/magic-link/verify` separately | 5 a minute | **30 a minute** (the magic-link plugin's own `rateLimit` option) |
| Per email address, requesting a link | — | **10 per 15 minutes**, so one inbox cannot be flooded through the larger IP allowance |
| Where counts live | Better Auth's memory, per serverless instance | The store the public endpoints already use (`RATE_LIMIT_STORE`: Upstash in production, a Postgres table elsewhere), through `rateLimit.customStorage` |
| When a blocked caller is free again | After a full quiet minute — every allowed request pushed the window forward | At the end of the fixed window |

- **No enumeration:** the per-address limit runs in a `before` hook, ahead of the account lookup, so an unknown address is counted and refused exactly like a real one. A 429 therefore says nothing about who has an account. The test asserts this for both.
- **Why 30 and 10:** a leaders' onboarding session is a dozen people on one address, each requesting a link and then opening it; 30 a minute per path carries that with room to spare, while still stopping a script. Ten emails per address per quarter of an hour covers a leader retrying two or three times and bounds one inbox at 40 messages an hour.
- **Rejected:** `rateLimit.storage: 'database'` would have needed a new table and a migration, and `'secondary-storage'` would have moved session storage out of PostgreSQL, which `src/server/next/context.ts` reads directly for `two_factor_verified_at`.

### 8.2 Security headers (all routes)
`Strict-Transport-Security: max-age=63072000; includeSubDomains; preload` · `Content-Security-Policy` (nonce-based, `frame-ancestors 'none'`, `object-src 'none'`, `base-uri 'self'`) · `Referrer-Policy: strict-origin-when-cross-origin` (`no-referrer` on token routes) · `Permissions-Policy: camera=(), microphone=(), geolocation=()` · `X-Content-Type-Options: nosniff` · `Cross-Origin-Opener-Policy: same-origin`.

**Implementation note (M5, 2026-09-17).**
- **Where the policy is set:** `src/proxy.ts` builds the Content-Security-Policy for every request except API routes and build assets (`src/server/security/csp.ts`). The other headers are in `next.config.ts`.
- **Scripts:** `script-src 'self' 'nonce-…' 'strict-dynamic'`. Next.js puts the nonce on its own scripts. Development adds `'unsafe-eval'` for React's error overlay.
- **Every page is rendered per request:** the root layout awaits `connection()`. A page prerendered at build time would carry no nonce, and the browser would block its scripts.
- **Styles:** `style-src 'self' 'unsafe-inline'`, not a nonce. Server-rendered `style` attributes (progress bars, chart colours) can't carry one, and adding a nonce would switch `'unsafe-inline'` off. Inline styles can't run code, so scripts stay strict.
- **Other directives:**
  - `connect-src` adds Sentry's ingest host only when `NEXT_PUBLIC_SENTRY_DSN` is set.
  - `upgrade-insecure-requests` is added when `APP_URL` is https.
  - `img-src` allows `data:` and `blob:`.
- **Token routes:** `/a/…` and `/k/…` send `Referrer-Policy: no-referrer`. Being dynamic, they are sent with `no-store`.
- **Indexing:** `/robots.txt` disallows every path.
- **How it's checked:**
  - `tests/unit/csp.test.ts` covers the policy builder.
  - `tests/e2e/portal.security.spec.ts` checks the headers, that every script carries the response's nonce, the token pages, cross-site posts (refused with 403), markup in names (shown as text), HttpOnly SameSite session cookies, and pages with no policy violations. It runs in the E2E job, and against a production build in `.github/workflows/security.yml`.
  - The same workflow runs an OWASP ZAP baseline scan. Only the rules marked FAIL in `.zap/rules.tsv` fail it.
  - It also runs `npm audit` (high and critical fail) and gitleaks.

### 8.3 Data protection
- TLS everywhere; managed encryption at rest; encrypted backups.
- **Field-level encryption (V1)** for pastoral notes and confidential answers: AES-256-GCM, keys from the platform secret store with a key version per ciphertext (rotation-ready).
- **Row-Level Security (V1, defence-in-depth)** on content tables (`form_answer_sets`, `person_notes`, `journal_reviews`), with the actor's scope set per transaction via `SET LOCAL`. Answers are stored one row **per sensitivity tier**, so RLS can gate *confidential* rows independently. In the MVP, the policy layer plus the test matrix are the primary control.
- DB roles: `app_rw` (no DDL, **INSERT-only on `audit_logs`**), `migrator` (DDL), `reporting_ro` (read replica later).
- **Implementation note (row-level security baseline, migration 0007, 2026-09-15).** Every table has row-level security enabled now, ahead of the scoped V1 policies:
  - The group role `gentouch_app` holds the table privileges and one permissive policy per table. The application's login role joins it (`GRANT gentouch_app TO app_rw`). `UPDATE` and `DELETE` on `audit_logs` are revoked from it, so audit entries are insert-only.
  - Any other role sees no rows, including Supabase's Data API roles `anon` and `authenticated`. On Supabase those two roles also lose every table and sequence privilege in `public`.
  - Table owners (migrations, local development and tests) bypass row-level security, so nothing changes there.
  - A new table needs `ENABLE ROW LEVEL SECURITY` and the `gentouch_app_full_access` policy in its migration. `tests/integration/schema.test.ts` and the CI PostgreSQL job fail until it has both.
- Secrets only in environment variables or the platform secret store; `.env.example` is documented; no secrets in the repo; CI secret scanning.

### 8.4 Privacy by design
- Collect only what is needed. Gender, address, and full birth year are **off by default** (settings toggles).
- Consent recorded with version and timestamp; guardian consent for minors.
- Data-class retention defaults (configurable; confirm with your pastors and counsel): journal *content* 3 years then purged (status kept), prayer reports 2 years, audit logs 5 years (IP/UA nulled after 90 days), action tokens deleted after expiry, rate-limit buckets 24 h.
- PH DPA points to confirm with counsel: appoint a Data Protection Officer; register with the NPC if thresholds apply; data-processing agreements with processors (hosting, email, SMS); cross-border transfer (Singapore hosting) documented; breach notification procedure (the NPC expects notification within 72 hours of knowledge).

---

## 9. Performance & scalability

| Concern | Approach |
|---|---|
| Hierarchy reads | Closure table: whole-branch queries are a single indexed join; no recursion at request time (Phase 3 §3) |
| Journal dashboards | The ledger (`journal_days`) is narrow (no content) and indexed by `(journal_date, leader_person_id)` plus a `btree_gin (journal_date, hierarchy_path)` index for branch rollups; today's dashboard for 50k people aggregates in single-digit ms to low tens of ms |
| History & trends | 7/30-day rates computed from the ledger with index-only scans. V1 adds `journal_leader_daily_summary` (~156 rows/day today) for multi-year trends |
| Lists | Server-side pagination: offset pagination with total counts for bounded, filterable tables (people ≤ 50k, page size 25–100); **keyset** pagination for unbounded streams (audit, journal history, deliveries) |
| N+1 | Repositories return fully shaped DTOs via joins or batched `IN (…)` lookups; a lint/test check counts queries per request in integration tests for hot pages |
| Caching | Per-request memoisation; short-TTL (30–60 s) tag-based caching for heavy aggregate widgets, invalidated on submission/review for that scope; no cross-user caching of personal data; static assets at the edge |
| Connections | Provider connection pooler (PgBouncer, transaction mode); pool sizing per instance |
| Growth | Declarative partitioning of `journal_days` and `audit_logs` by year once each passes ~50M rows; a read replica for reports if needed |
| Load targets (k6) | 50 journal submits/s sustained for 10 min; 200 concurrent portal users; p95 targets as in Phase 1 NFRs |

---

## 10. Extensibility strategy (future modules)

Future modules plug into **shared kernels** instead of rebuilding them:

| Shared kernel | Reused by future modules |
|---|---|
| `people` + `hierarchy` + `ministries` | Every module |
| `forms` engine (versioned fields, typed answers, sensitivity) | Visitor cards, new-believer forms, event registration, testimonies, counselling intake, training feedback |
| `care` follow-ups (generic tasks about a person) | Visitors, new believers, discipleship, counselling, attendance drop-off |
| `scheduling` utilities (rrule, rolling generation, unavailability, action tokens) | Volunteer scheduling, events, cell group meetings |
| `links` (entry codes, action tokens, device keys) | Event check-in QR, attendance QR |
| `notifications` | Everything |
| `policy` (permissions + scopes) | New permissions are registered in the catalog; new scope types added as needed |

Each new module = new tables + a service + permissions registered in the catalog + nav entry behind a **feature flag** (`system_settings.features`). A future mobile app uses a versioned `/api/v1` over the same services with token-based auth (Better Auth supports bearer/JWT plugins).
