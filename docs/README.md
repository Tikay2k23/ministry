# MINISTRY SYSTEM — PRODUCT & ARCHITECTURE BLUEPRINT

**Ministry:** Generation Touch Harvest International (**GenTouch**) · *There's a Nation Inside of You!*
**Product (working name):** GenTouch Ministry System
**Version:** 0.1 draft · 2026-09-12
**Status:** Phases 1–7 complete → **awaiting your decisions (below) before Phase 8 (implementation)**

| Phase | Document |
|---|---|
| 1 · Product requirements (understanding, users, FRs, NFRs, business rules, assumptions, edge cases) | [01-product-requirements.md](01-product-requirements.md) |
| 2 · System architecture (stack, architecture, auth, public forms, QR, notifications, jobs, security, performance) | [02-system-architecture.md](02-system-architecture.md) |
| 2a · Service & API contracts | [02a-api-contracts.md](02a-api-contracts.md) |
| 3 · Database (hierarchy strategy, full DDL, relationships, indexes, deletion, growth) | [03-database.md](03-database.md) |
| 4 · User experience (principles, visual language, IA, wireframes, every page) | [04-user-experience.md](04-user-experience.md) |
| 5 · Workflows (the 14 requested + 2 supporting) | [05-workflows.md](05-workflows.md) |
| 6 · Permission matrix (roles × resources × actions, sensitive-data table, tests) | [06-permission-matrix.md](06-permission-matrix.md) |
| 7 · Roadmap, risks, QA strategy, Phase 8 plan | [07-roadmap.md](07-roadmap.md) |

Working documents, added while building: [accessibility-checklist.md](accessibility-checklist.md) (the manual screen-reader pass) and [pilot/](pilot/) — the [leader quick start](pilot/leader-quick-start.md), the [video script](pilot/video-script.md) and the [pilot plan](pilot/pilot-plan.md).

---

## Executive summary

A **mobile-first, login-free experience for participants** (QR → recognised phone → journal in under 30 seconds) on top of a **secure, scoped portal for shepherds** (leaders see *their* people, pastors see the ministry, nobody sees more than policy allows).

Technically it is a **Next.js + TypeScript modular monolith with a background worker, on PostgreSQL**. Two data-model ideas carry most of the weight:

1. **Adjacency list + closure table** for the leadership tree, so whole-branch queries are a single indexed join at any depth or size.
2. **A daily accountability ledger** (`journal_days`) kept separate from journal content, so dashboards are fast and never touch private words.

The MVP delivers your four priorities in order: **Hierarchy → Journal → Prayer Chain → Devotional**, in roughly 12–13 developer-weeks, with a two-week pilot on one branch before full rollout.

---

## Critical analysis: where I disagree with or refine the brief

I agree with the overall direction. These are the places where following the brief literally would cause problems:

| # | Issue in the brief | Risk if built as written | Recommendation |
|---|---|---|---|
| 1 | **"Recognise returning people by mobile number"** | Typing a phone number and seeing a name and leader pre-filled lets anyone discover who belongs to the ministry and who leads them. Religious affiliation is *sensitive personal information* under the PH Data Privacy Act. It also makes impersonation trivial | **Identification ladder:** remembered device (secure cookie) → leader-sent personal link → phone **+ first-name confirmation** (rate-limited, uniform responses) → register. **Nothing stored is displayed before identification succeeds.** OTP in V1 |
| 2 | **Journal statuses listed as one list** (Submitted, Missing, Late, Not reviewed, Reviewed, Needs follow-up) | These overlap (an entry can be *Late* **and** *Reviewed* **and** *Needs follow-up*). One enum makes reporting wrong | **Three independent dimensions**: Submission · Review · Care |
| 3 | **"Missing" without a definition of "expected"** | Missing counts become wrong and hurtful (people on leave, rest days, new registrants, mid-day transfers) | Explicit expectation rules + rest days + personal pauses + **"Not yet"** until the deadline; "Missed" only after the day closes |
| 4 | **The 12 / 144 / 1,728 numbers** | If leaders journal too, expected is ≈ **1,884**, not 1,728. And the 144 + 12 leaders *do* need portal accounts to see their people (~160 accounts) | Everyone can be expected; leaders get **passwordless magic-link login with 30-day sessions on their phone**, so it *feels* like no login |
| 5 | **Super Admin "can see everything"** | The technical administrator reads pastoral content by default. That is a trust and privacy failure waiting to happen | **System administration ≠ pastoral access.** Super Admin gets no journal/pastoral content by default; audited **break-glass** access with a reason notifies the Pastors |
| 6 | **Journal content visibility up the hierarchy** | Primary leaders reading 144 people's private reflections by default discourages honesty | Default: **direct leader + pastoral roles**; configurable depth. Plus **entries follow the relationship at the time of writing** (BR-J-11): after a transfer, the new leader doesn't inherit years of private history |
| 7 | **"Primary Leader" and "Leadership Level" as person fields** | Hand-typed values drift from the real tree within weeks | **Derived** from the hierarchy (primary = ancestor at the configured depth; level names configured per depth). Snapshotted on the ledger for history |
| 8 | **Leader can be changed from the public form** | Anyone could move themselves (or others) between leaders | Public changes become **requests** approved by the receiving leader / Primary Leader / Admin |
| 9 | **Prayer "Missed" and "Late confirmation"** | Automatic negative labels at 3 AM for honour-based prayer | System sets only **Needs follow-up**; **Missed/Excused are human decisions** (enforced by a DB constraint). *Confirm* (commitment), *check in* and *complete* are distinct events |
| 10 | **Data migration isn't mentioned** | No one will hand-type ~1,900 people and their leaders; this is the real MVP blocker | **CSV import with hierarchy, preview and duplicate detection is in the MVP** |
| 11 | **SMS / WhatsApp as primary channels** | One daily SMS reminder to ~1,900 people costs very roughly ₱20k–₱55k/month in PH, and WhatsApp is less used there than Messenger/Viber | Free channels first (in-app, email, web push, **Share-to-Messenger/Viber** buttons), opt-in reminders only to people who haven't submitted, daily SMS cap |
| 12 | **Minors and privacy law** | Youth members may journal; consent rules differ | Guardian-consent step (setting); data minimisation (gender/address/birth year **off** by default); DPO, NPC and processor agreements to confirm with counsel |
| 13 | **"Thousands of users" → temptation to over-engineer** | Microservices, Kafka or Redis add cost and failure modes with zero benefit at ≤ 50k people | **Modular monolith + one Postgres + one worker.** Clean module boundaries make later extraction mechanical |
| 14 | **Prisma suggested** | This model relies on partial unique indexes, exclusion constraints, closure-table SQL, array snapshots and idempotent upserts | **Drizzle** (SQL-first, typed). Prisma remains viable, with more hand-written SQL |
| 15 | **Leader sees only "directly assigned people"** | Works today, but ages badly: once disciples lead their own 12, their leader goes blind to their own branch | Keep your default (depth 1) but make it a setting; I recommend **whole-downline *status*** (never content) once multiplication begins |
| 16 | **High-performing groups / KPI dashboards** | Ranking leaders publicly turns discipleship into competition | "**Groups to celebrate / may need encouragement**", sorted by name not rate; no red for people; streaks visible to leaders only |
| 17 | **Daily review of every journal** | ~1,900 reads/day across ~157 leaders; fatigue is likely | Fast one-at-a-time review queue with keyboard shortcuts; review is optional per ministry policy |

Where I **deliberately did not generalise**: prayer slots and worship rosters stay separate domains, because their rules differ. They share only infrastructure (recurrence, tokens, unavailability, notifications).
Where I **did generalise now**, because retrofitting later is expensive: a versioned **forms engine** (future visitor, event and testimony forms) and a generic **care follow-up** list (future new-believer and visitor care).

---

## Key architecture decisions (ADR summary)

| ADR | Decision | Main alternative | Why |
|---|---|---|---|
| 01 | Next.js modular monolith, one codebase. *Changed 2026-09-15: no separate worker process (see 09)* | Separate API service | One language/codebase; framework-free domain modules allow later extraction |
| 02 | PostgreSQL + **Drizzle** | Prisma | SQL-heavy integrity features stay typed |
| 03 | **Better Auth**, invitation-only, magic link + TOTP (passkeys V1). *2026-09-15: Supabase Auth is the approved target; the move needs a Supabase project* | Clerk / Auth.js | Sessions and identities stay in our database; strong 2FA |
| 04 | Participants have **no accounts**: device keys, personal links, action tokens | Accounts for everyone | Your #1 UX rule, with safe identity |
| 05 | Adjacency list + **closure table** + ledger path snapshot | ltree / recursive CTE only | Fast branch queries, simple moves, correct history |
| 06 | **Journal ledger** (`journal_days`) separate from content | Compute "missing" on the fly | Correct history, fast dashboards, status/content permission split |
| 07 | Versioned **forms engine**; answers stored **by sensitivity tier** | Hard-coded columns / per-answer rows | No-code question changes; RLS & encryption per tier |
| 08 | **Scoped RBAC** (permission × scope) + sensitivity tiers | Flat roles | Same role, different data by place in the tree |
| 09 | *Changed 2026-09-15:* **in-app scheduler with leases, triggered by Supabase Cron**; idempotent jobs (docs/02 §7 note) | Graphile Worker; Redis/BullMQ | Runs on Vercel and against the embedded development database; no extra infrastructure |
| 10 | Provider-agnostic notifications; free channels first | Single SMS vendor | Cost control; swap providers freely |
| 11 | UUIDv7 internal ids; separate public codes/tokens | Sequential ids | No enumeration; no ids in QR codes |
| 12 | **Single-tenant (one deployment per ministry)** | Multi-tenant SaaS | Strongest isolation for pastoral data; revisit only if D3 changes |
| 13 | Cloudflare edge + **conditional** Turnstile | Always-on CAPTCHA | Real people rarely see a challenge |

---

## Decisions needed from you before Phase 8

Reply with answers, or "**proceed with defaults**". Each has a sensible default already built into the blueprint.

| # | Decision | My default |
|---|---|---|
| **D1** | Confirm country, timezone and privacy law | Philippines · `Asia/Manila` · RA 10173 |
| **D2** | Journal **content** visibility: direct leader + pastoral only, or Primary Leaders read their whole branch? | Direct leader + pastoral (depth 1) |
| **D3** | One ministry only, or will you offer this to **other churches** (SaaS)? Also: does *Harvest **International*** mean branches/campuses in other cities or countries? Branches can live in one deployment as campuses, but that changes timezones, scoping and reporting, so it must be decided *now* | One ministry, one campus (single-tenant) |
| **D4** | Should leaders see **status** of their whole downline as it multiplies? | Direct group now; switch to whole downline when groups multiply |
| **D5** | Hosting preference and monthly budget (Railway / Render / Fly.io / AWS / DigitalOcean) | Container platform + managed Postgres, Singapore region |
| **D6** | Do **all levels** journal? Deadline (default 11:59 PM) and late cutoff (default 9:00 AM next day)? Is daily review expected? | All levels; 23:59 / 09:00; review expected |
| **D7** | Do **minors** participate? | Yes → guardian consent enabled |
| **D8** | What does your current data look like? An **anonymised sample** (column headers + 5 fake rows) lets me design the importer precisely | Template CSV of my own |
| **D9** | ✅ **Answered 2026-09-12**: GenTouch logo received; palette and typography derived from it ([Phase 4 §2](04-user-experience.md)). Still needed: **original logo files** (SVG/AI/EPS, or a high-resolution transparent PNG) and the designer's exact colour values | — |
| **D10** | Who will hold **Pastoral Care** access, and who is your Data Protection Officer? | Senior pastor(s) only |

---

## What happens next

After your decisions, Phase 8 starts with **M0 · Foundation** and **M1 · People & Hierarchy** (see [07-roadmap.md §8](07-roadmap.md)). I'll deliver complete files with paths, keep the database concepts in this blueprint unchanged (any change is proposed first and recorded as an ADR), and state explicitly whenever a **migration** must be run or an **environment variable** is needed.
