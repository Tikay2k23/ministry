# Phase 1 — Product Requirements

> Part of the **Ministry System — Product & Architecture Blueprint**. See [README](README.md) for the index, the critical analysis, and open decisions.
> Requirement IDs (`FR-JRN-04`, `BR-H-03`, …) are referenced by later phases and by tests.
> Priority tags: **[MVP]**, **[V1]**, **[V2]**.

---

## 1. Understanding of the ministry system

The ministry runs a **leadership-multiplication (cell/G12-style) discipleship model**: overall leadership disciples 12 Primary Leaders, each of whom disciples 12 leaders (144), each of whom disciples up to 12 people (1,728), and those people are expected to eventually disciple others. The tree is open-ended — depth and branching are not fixed.

Three **daily spiritual rhythms** are the heartbeat of the system:

| Rhythm | Who | Nature | What leadership needs |
|---|---|---|---|
| **Daily Journal** | Everyone expected to journal (all levels — leaders journal too) | Individual devotion, reported upward to one's leader | Who has / hasn't submitted; leader reads and responds; gentle follow-up when someone drifts |
| **Morning Devotional** | Scheduled worship team + prayer/scripture/devotional roles | Corporate gathering, a roster per morning | Who is serving, whether they confirmed, substitutes when someone can't |
| **Prayer Chain** | Prayer participants in time slots | Continuous or scheduled intercession | Every slot is covered; someone notices gently when a slot was not confirmed |

Two **independent structures** organise people and must never be merged:

1. **Leadership (spiritual) hierarchy** — *who disciples whom*. A strict tree: each person has at most one current direct leader.
2. **Ministry (service) structure** — *where a person serves*: Ministry → Department → Team. Many-to-many: one person can serve in several ministries and teams. It has nothing to do with who their spiritual leader is.

Two kinds of people use the system, and they need very different things:

- **Participants (~90%+ of people)** never log in. They use QR codes and links on their phones, often low-end Android devices on patchy mobile data. For them the system has to feel like texting a friend: under 60 seconds, no password, no clutter.
- **Portal users (leaders, coordinators, pastors, admins)** need calm, trustworthy visibility over their own scope, and no more than that.

**Product intent:** the system supports discipleship and does not measure spirituality. It records *faithfulness signals* (did the journal arrive, was the slot covered) so shepherds notice who needs care. It is not a performance-management tool, and the language, colour and design choices in Phase 4 are there to protect that.

### Success measures (non-KPI framing)
| Measure | Target |
|---|---|
| Returning participant journal submission time on a phone | **≤ 30 s** (first time ≤ 90 s) |
| Leader: open app → knows who hasn't journaled today | **≤ 10 s**, 2 taps |
| Admin time spent compiling journal/prayer reports manually | Eliminated |
| Participants required to create an account | **0** |
| Journal content visible to someone the ministry policy does not allow | **0 incidents** |

---

## 2. Core user types

### 2.1 Participants (no login)
| Persona | Est. count | Channel | Core jobs |
|---|---|---|---|
| **Member / Worker** | ~1,700 now → 50k | QR, personal link, installed web app (PWA) | Submit journal daily; register the first time; confirm a serving or prayer assignment |
| **Prayer Chain Participant** | tens–hundreds | Chain QR, personal action link | See their slot; confirm; check in; mark complete; optionally share a report/testimony |
| **Worship / Devotional Team Member** | tens | Personal action link | Accept or decline an assignment; request a substitute |

> Leaders and Primary Leaders are **also participants**: they submit their own journals through the same public flow.

### 2.2 Portal users (login)
| Persona | Est. count | Scope of visibility | Core jobs |
|---|---|---|---|
| **Leader** (anyone with disciples who has been given portal access) | ~144 now, grows with multiplication | Their **direct group** | See who journaled today, read and review journals, flag follow-ups, confirm new registrations |
| **Primary Leader** | 12 | Their **whole branch** (status); their direct group (content, by policy) | Branch health across sub-leaders; reviews their own 12; encourages struggling groups |
| **Pastor / Executive Leadership** | 1–10 | Whole ministry | Ministry-wide picture, trends, pastoral oversight, approvals |
| **Pastoral Care Staff** *(new — recommended)* | 0–5 | Assigned people / whole ministry | Handles confidential journal answers, pastoral notes, sensitive follow-ups |
| **Ministry Administrator (Office)** *(new — recommended)* | 1–5 | Whole directory, **no journal content** | Data entry, imports, corrections, reassignments, QR printing |
| **Ministry Head** | ~10–20 | Their ministry | Ministry members, departments, teams, ministry schedules if permitted |
| **Worship Coordinator** | 1–3 | Devotional/worship | Teams, rotations, rosters, substitutes |
| **Prayer Chain Coordinator** | 1–5 | Their chains | Chain design, slot assignment, follow-up on unconfirmed slots |
| **Super Admin** | 1–2 | System configuration | Settings, roles, integrations. **No automatic access to pastoral content** (see README §Critical analysis #5) |
| **Viewer** | few | As assigned, aggregates | Read-only dashboards and reports |

About 170–250 portal accounts are expected at today's size. Every other person is a participant.

---

## 3. Functional requirements

### 3.1 People directory — `PPL`
| ID | Requirement | Pri |
|---|---|---|
| FR-PPL-01 | Central directory of people with a stable internal UUID and a human-friendly, **non-sequential** `person_code` (e.g. `P-7K3M9Q`) | MVP |
| FR-PPL-02 | Profile fields: first/middle/last name, suffix, preferred name, gender (setting-controlled), mobile (normalised E.164), email, birthday (month/day, year optional), address (setting-controlled), date joined, status (active/inactive), designations, consent record | MVP |
| FR-PPL-03 | A person can hold multiple **designations** (Member, Worker, Pastor, Staff…); labels such as *Leader*, *Primary Leader*, *Worship Team Member*, *Prayer Chain Participant* are **derived** from hierarchy/team/chain data, not typed by hand | MVP |
| FR-PPL-04 | Search by name (fuzzy, accent-insensitive), phone, person code; filter by direct leader, primary leader, ministry, department, team, leadership level, status, designation, registration status | MVP |
| FR-PPL-05 | Server-side pagination, sorting, and filter state in the URL (shareable, back-button safe) | MVP |
| FR-PPL-06 | Duplicate detection on create/import/registration (same phone, similar name + same leader, same email); a review queue; **merge** with full history re-pointing and audit | MVP (detect + queue), V1 (merge UI) |
| FR-PPL-07 | Public registrations enter as **Unconfirmed** and appear in the chosen leader's "New — please confirm" list; they are excluded from expected counts until confirmed | MVP |
| FR-PPL-08 | Archive (soft delete) with a reason; archived people disappear from lists, selectors and reminders but keep their history | MVP |
| FR-PPL-09 | Person notes with visibility tiers: *Leadership* and *Pastoral (confidential)* | V1 |
| FR-PPL-10 | Bulk **CSV import** of people **with hierarchy** (leader referenced by person code, phone or exact name) with validation preview, duplicate detection and a dry run | **MVP** |
| FR-PPL-11 | Export directory (CSV) within permitted scope, audited | MVP |
| FR-PPL-12 | "Deceased" handling: archive with a reason that suppresses **all** notifications immediately | MVP |

### 3.2 Leadership hierarchy — `LDR`
| ID | Requirement | Pri |
|---|---|---|
| FR-LDR-01 | Unlimited-depth tree; each person has **0 or 1 current direct leader** | MVP |
| FR-LDR-02 | Configurable **leadership level names by depth** (e.g. 0 = Senior Leadership, 1 = Primary Leader, 2 = Leader, 3 = Member). Primary leader = the ancestor at the configured "primary depth" (default 1) | MVP |
| FR-LDR-03 | Efficient queries: direct group, whole branch, ancestors (chain of leadership), per-sub-branch rollups | MVP |
| FR-LDR-04 | Place, move (with the whole sub-tree) or remove a person; cycles are prevented; all changes are effective-dated and kept in history | MVP |
| FR-LDR-05 | Tree explorer (lazy-loaded), branch view, "chain of leadership" breadcrumb on every profile | MVP |
| FR-LDR-06 | **Leader change requests**: from the public form (person selects a different leader) or the portal; approved by the receiving leader, a Primary Leader in scope, or an admin | MVP |
| FR-LDR-07 | Leader deactivation / archive **requires** reassigning their direct group (wizard: all to one leader / individually / temporarily to their own leader) | MVP |
| FR-LDR-08 | `accepts_members` flag controls whether a person appears in the public leader selector | MVP |
| FR-LDR-09 | Temporary **review delegation** (a leader on leave delegates journal review to another leader for a date range) | V1 |

### 3.3 Ministry structure — `MIN`
| ID | Requirement | Pri |
|---|---|---|
| FR-MIN-01 | Ministries → optional Departments → Teams | MVP |
| FR-MIN-02 | Ministry memberships (person, ministry, optional department, position: member/worker/head/assistant head, primary flag, start/end) | MVP |
| FR-MIN-03 | Team memberships with default **serving roles** (e.g. keyboard + backup vocal) | MVP |
| FR-MIN-04 | Ministry-scoped role assignment (Ministry Head sees only their ministry) | MVP |

### 3.4 Daily journal — `JRN`
| ID | Requirement | Pri |
|---|---|---|
| FR-JRN-01 | Public mobile journal at `/j` (general) and `/j/{leaderCode}` (leader QR — leader preselected); no login | MVP |
| FR-JRN-02 | Identification ladder: remembered device → personal link → phone + first-name check → register. **No stored data is displayed before identification succeeds** | MVP |
| FR-JRN-03 | First submission registers the person (name, mobile, leader, ministry if required by settings, privacy consent) | MVP |
| FR-JRN-04 | Returning person: leader preselected; choosing a different leader creates a **leader change request**; it does not reassign directly | MVP |
| FR-JRN-05 | Searchable leader selector: only `accepts_members` leaders, min 2 characters, max 8 results, rate-limited | MVP |
| FR-JRN-06 | Configurable journal form: field types short text, long text, yes/no, single choice, multiple choice, number, scripture reference, prayer request, testimony, reflection, gratitude, date/time; required flag; help text; **sensitivity** (standard/restricted/confidential); order; activate/deactivate — **versioned**, no code change | MVP (core types) |
| FR-JRN-07 | **One journal per person per journal date.** Double-taps are made idempotent. A second submission becomes a controlled **edit** (remembered device, within the edit window) with revision history | MVP |
| FR-JRN-08 | Journal-date rules: ministry timezone; deadline; late window after midnight in which the person chooses "yesterday" or "today" | MVP |
| FR-JRN-09 | Accountability ledger: one row per expected person per day, with three independent dimensions — **Submission** (Not yet / Submitted / Late / Missed / Excused), **Review** (Awaiting / Reviewed), **Care** (None / Needs follow-up / Resolved) | MVP |
| FR-JRN-10 | Expected rules: person is active + confirmed + placed in the hierarchy + `journal_expected`; minus **rest days** (ministry calendar) and **personal pauses** (leave, sickness, travel) | MVP |
| FR-JRN-11 | Leader "Today" view: their people, status, quick links to read and review | MVP |
| FR-JRN-12 | Review: read entry (permission-gated), mark reviewed, optional private comment, flag for follow-up | MVP |
| FR-JRN-13 | Branch summaries: per sub-leader rollups (e.g. `Leader A 11/12`), branch totals and % | MVP |
| FR-JRN-14 | Ministry-wide totals for Pastor/Exec | MVP |
| FR-JRN-15 | Consistency: 7-day, 30-day, calendar-month rates; consecutive missed days; "groups to celebrate" / "groups that may need encouragement" (no public leaderboards) | MVP (7/30-day, streak), V1 (monthly & group insights) |
| FR-JRN-16 | Auto-suggested follow-up when consecutive missed days ≥ threshold (default 3) | MVP |
| FR-JRN-17 | Proxy submission by a leader for someone without a phone (marked as proxy, audited) | MVP |
| FR-JRN-18 | Excuse a person/day, or declare a ministry-wide rest day, with a reason | MVP |
| FR-JRN-19 | Leader encouragement message delivered back to the submitter | V1 |
| FR-JRN-20 | Participant sees their own last 7 entries (remembered device only) | V1 |
| FR-JRN-21 | Per-person timezone for members abroad | V1 |

### 3.5 Prayer chain — `PRY`
| ID | Requirement | Pri |
|---|---|---|
| FR-PRY-01 | Chains: continuous 24-hour, scheduled blocks, one-time event; timezone; grace minutes; active window | MVP |
| FR-PRY-02 | Slot generation from recurring schedules (RRULE) with configurable duration and capacity; one-off slots | MVP |
| FR-PRY-03 | **Recurring commitments** ("Mary, every Tuesday 2–3 AM") that auto-assign generated slots | MVP |
| FR-PRY-04 | Manual assignment, reassignment and substitute assignment, with conflict detection (a person cannot hold overlapping slots) | MVP |
| FR-PRY-05 | Participant actions without login via chain QR (remembered device) or personal action link: **confirm** (before), **check in** (at start), **complete** (after), **can't make it** (triggers substitute search) | MVP |
| FR-PRY-06 | Optional prayer report / testimony / prayer request after completion, via a configurable form; anonymity option for requests | MVP (basic), V1 (anonymous requests routing) |
| FR-PRY-07 | Status model: Upcoming → Confirmed → In prayer → Completed; *Late completion* flag; *Substitute assigned*; after end + grace without completion → **Needs follow-up** (automatic). **Missed** / **Excused** are set **only by a coordinator** | MVP |
| FR-PRY-08 | Chain board: day timeline with coverage, who is praying now, gaps, follow-ups | MVP |
| FR-PRY-09 | Coordinator follow-up queue | MVP |
| FR-PRY-10 | "Pass the baton" — notify the next person when the previous slot completes | V1 |
| FR-PRY-11 | Self-sign-up for open slots from the chain page | V1 |

### 3.6 Morning devotional / worship — `DEV`
| ID | Requirement | Pri |
|---|---|---|
| FR-DEV-01 | Gathering types (Morning Devotional now; Sunday service etc. later) with a template of required serving roles and counts | MVP |
| FR-DEV-02 | Configurable serving roles (Worship Leader, Lead Vocal, Backup Vocal, Keyboard, Guitar, Bass, Drums, Prayer Leader, Scripture Reader, Devotional Leader, Host, Tech/Sound, …) | MVP |
| FR-DEV-03 | Worship teams (a type of Team) with members and each member's default roles | MVP |
| FR-DEV-04 | Schedules: daily/weekly/monthly recurrence; **team rotation** (A→B→C); rolling generation window (default 8 weeks) | MVP |
| FR-DEV-05 | Per-gathering roster: auto-filled from the team, editable per role; manual assignment; notes | MVP |
| FR-DEV-06 | Assignment confirmation via secure personal link (accept/decline + note), no login | MVP |
| FR-DEV-07 | Substitute flow: decline → coordinator notified → suggested substitutes (same role, available, not already serving) → assign | MVP |
| FR-DEV-08 | Availability / unavailability dates per person, respected by suggestions and warnings | V1 (MVP: manual unavailable dates) |
| FR-DEV-09 | Dashboard card: today's gathering, team, roster, confirmation counts | MVP |

### 3.7 Command Center (dashboard) — `DSH`
| ID | Requirement | Pri |
|---|---|---|
| FR-DSH-01 | Role-adaptive "Ministry Today": journal, prayer chain, devotional, **Needs attention** list | MVP |
| FR-DSH-02 | Scope switcher (All ministry / a branch / my group) limited to the user's permitted scopes | MVP |
| FR-DSH-03 | Progressive disclosure: summary → drill-down lists → record | MVP |
| FR-DSH-04 | 30-day journal trend, upcoming devotional assignments, recent submissions (status only), follow-ups | MVP (trend + follow-ups), V1 (rest) |
| FR-DSH-05 | Announcements | V2 |

### 3.8 Reports — `RPT`
| ID | Requirement | Pri |
|---|---|---|
| FR-RPT-01 | Daily / Weekly journal report; Monthly consistency; Leader accountability; Branch report | MVP (daily, weekly, branch), V1 (rest) |
| FR-RPT-02 | Prayer chain completion; Prayer slot attendance | MVP (completion) |
| FR-RPT-03 | Devotional assignments; Worship team participation | V1 |
| FR-RPT-04 | People directory report | MVP |
| FR-RPT-05 | Filters: date range, leader/branch, ministry, team, status; always constrained to the viewer's scope | MVP |
| FR-RPT-06 | CSV export (streamed, audited, scope-limited); PDF export | MVP (CSV), V1 (PDF) |
| FR-RPT-07 | Scheduled weekly/monthly report emails to leadership | V1 |

### 3.9 Notifications — `NTF`
| ID | Requirement | Pri |
|---|---|---|
| FR-NTF-01 | Provider-agnostic framework: in-app, email, SMS, web push, (WhatsApp/Viber/Messenger later) | MVP (in-app + email + share links), V1 (SMS, web push) |
| FR-NTF-02 | Templates per notification type × channel × locale, versioned, editable by admins | MVP |
| FR-NTF-03 | Per-person preferences, opt-in/opt-out, quiet hours, daily SMS budget cap | V1 |
| FR-NTF-04 | Dedupe keys so the same reminder is never sent twice | MVP |
| FR-NTF-05 | Delivery log with provider status callbacks | V1 |
| FR-NTF-06 | "Share via Messenger/Viber/…" (Web Share API) for coordinators to send personal links manually at zero cost | MVP |

### 3.10 QR & public links — `QR`
| ID | Requirement | Pri |
|---|---|---|
| FR-QR-01 | Entry codes for the general journal, each leader's journal, each prayer chain | MVP |
| FR-QR-02 | Printable QR cards/posters (SVG/PNG, later PDF) with ministry branding and leader name | MVP (SVG/PNG) |
| FR-QR-03 | Codes are random and short, contain no personal data, and can be **rotated** (old code shows a friendly "this code was replaced" page) | MVP |
| FR-QR-04 | Personal action tokens (prayer/serving), secret, expiring, single-purpose, stored hashed | MVP |
| FR-QR-05 | Personal journal link ("My Journal") that a leader can send to a member to restore recognition on a new phone | MVP |

### 3.11 Users, roles & permissions — `IAM`
| ID | Requirement | Pri |
|---|---|---|
| FR-IAM-01 | Invitation-only portal accounts linked to a person record | MVP |
| FR-IAM-02 | Passwordless email magic link (primary), optional password, Google sign-in optional | MVP |
| FR-IAM-03 | Mandatory TOTP 2FA for roles holding sensitive permissions | MVP |
| FR-IAM-04 | Roles = bundles of granular permissions; **scoped** assignments (global / branch / ministry / team / prayer chain / gathering type) | MVP |
| FR-IAM-05 | Custom roles editable by Super Admin; system roles protected | V1 (MVP: seeded roles, assignments editable) |
| FR-IAM-06 | Session list and revoke; step-up re-authentication for sensitive actions | MVP (revoke), V1 (step-up) |
| FR-IAM-07 | Passkeys | V1 |

### 3.12 Audit — `AUD`
| ID | Requirement | Pri |
|---|---|---|
| FR-AUD-01 | Append-only audit of admin/data changes: actor, action, entity, old/new values (redacted for sensitive fields), timestamp, request id, IP/user agent (retained 90 days) | MVP |
| FR-AUD-02 | **Access log for sensitive reads** (journal content, confidential answers, pastoral notes, exports) | MVP |
| FR-AUD-03 | Audit viewer with filters; per-record history tab | MVP (per-record), V1 (global viewer) |

### 3.13 Privacy — `PRV`
| ID | Requirement | Pri |
|---|---|---|
| FR-PRV-01 | Privacy notice + consent capture at first registration (versioned) | MVP |
| FR-PRV-02 | Guardian consent for minors (if minors participate) | MVP (flag + capture) |
| FR-PRV-03 | Retention policies per data class with a scheduled purge (content purged, anonymous aggregates kept) | V1 (MVP: policy configured, purge job V1) |
| FR-PRV-04 | Data subject requests: export a person's data; correct; anonymise | V1 |
| FR-PRV-05 | "This is a shared phone" option: nothing remembered on the device | MVP |

### 3.14 Settings — `SET`
Ministry name/logo, timezone, journal policy (deadline, late window, edit window, content visibility depth, follow-up threshold), prayer defaults (grace), people-field toggles (gender, address, ministry-required), public form settings (phone+name identification on/off, Turnstile mode), notification channels. **[MVP]**

---

## 4. Non-functional requirements

| Area | Requirement |
|---|---|
| **Performance (public)** | Journal form first load ≤ 2.5 s on a slow 4G / low-end Android (LCP); ≤ 90 KB JS for public routes; submit round-trip p95 ≤ 800 ms server time |
| **Performance (portal)** | Dashboard and list pages p95 ≤ 800 ms server time at 50k people and 5 years of journal history |
| **Peak load** | Morning journal peak: ≈ 2,000 submissions in 2 hours today (≈ 0.3/s); design for 50/s bursts at 50k people |
| **Scalability** | Up to 50k people, 500 portal users, 10 years of ledger history (~180M ledger rows worst case → partitioning plan in Phase 3) |
| **Availability** | 99.5% monthly; public forms degrade gracefully (form keeps answers and retries on network failure) |
| **Backup/DR** | Managed PostgreSQL with point-in-time recovery; RPO ≤ 15 min, RTO ≤ 4 h; quarterly restore drill |
| **Security** | OWASP ASVS Level 2 as the baseline; OWASP Top 10 covered; see Phase 2 §8 |
| **Privacy** | Philippine Data Privacy Act (RA 10173) alignment assumed — religious affiliation is *sensitive personal information*; data minimisation; consent; DPO contact; breach notification process (confirm with counsel) |
| **Accessibility** | WCAG 2.2 AA; minimum 16 px body text (18 px on public forms); 48 px tap targets; full keyboard support in the portal; screen-reader labels |
| **Devices** | Public: Android Chrome 90+, iOS Safari 15+, 360 px width minimum. Portal: desktop, tablet, phone |
| **Localisation** | English first; all strings externalised so Filipino/Taglish can be added (V1); dates in ministry locale |
| **Time** | All instants stored as UTC `timestamptz`; all business dates computed in the ministry timezone (default `Asia/Manila`) |
| **Observability** | Error tracking, structured logs without PII, job monitoring, uptime checks, alerting on job failures |
| **Maintainability** | TypeScript strict; module boundaries; 100% test coverage on the authorisation policy layer and the hierarchy service; migrations reviewed as SQL |
| **Cost** | Runs on one small managed Postgres plus one small container host at today's scale; SMS spending is capped by settings |

---

## 5. Business rules

### Identity & people
- **BR-P-01** Mobile numbers are normalised to E.164 (default country PH). They are **not unique**: families share phones.
- **BR-P-02** A person may have no mobile number. Identification then falls back to a personal link, proxy submission by their leader, or email.
- **BR-P-03** Duplicate candidates are raised, never auto-merged. Merging is a human decision and is audited.
- **BR-P-04** People are never hard-deleted while they have history; they are archived. Anonymisation is the erasure mechanism.
- **BR-P-05** Derived labels (Leader, Primary Leader, Worship Team Member, Prayer Participant) are computed, never stored as editable fields.

### Hierarchy
- **BR-H-01** A person has at most one current direct leader.
- **BR-H-02** A person cannot be their own ancestor (no cycles). The check runs inside the same transaction as the move.
- **BR-H-03** Moving a person moves their entire sub-tree with them, unless the operator explicitly chooses to leave the direct group behind (then that group must be reassigned in the same operation).
- **BR-H-04** A leader with an active direct group cannot be deactivated or archived until the group is reassigned.
- **BR-H-05** Hierarchy changes are effective immediately and recorded in history. Journal ledger rows that are not yet finalised (today and later) are re-attributed; finalised days keep the leader who was in place at the time.
- **BR-H-06** Changing leadership from the public form always creates a **request**. Approval authority: the receiving leader, a Primary Leader or Pastor whose scope contains both leaders, or an Administrator.
- **BR-H-07** Leadership hierarchy and ministry membership are independent. Neither implies the other.

### Journal
- **BR-J-01** The journal date is computed in the ministry timezone from the submission time.
- **BR-J-02** A submission up to the **deadline** (default 23:59 of the journal date) is *Submitted*. Between midnight and the **late cutoff** (default 09:00 next day), if yesterday is not yet submitted, the person chooses "for yesterday" (→ *Late*) or "for today". After the cutoff, yesterday is closed to public submission.
- **BR-J-03** Before the deadline, an expected person without an entry is **"Not yet"**, never "Missing". At close (the late cutoff) they become **Missed**.
- **BR-J-04** One entry per (person, journal date). A repeat submission with the same idempotency key returns the original result. A deliberate second submission is an **edit**, allowed only from the remembered device within the edit window (default: until the deadline), and it creates a revision.
- **BR-J-05** Expected = active ∧ confirmed ∧ in hierarchy ∧ `journal_expected` ∧ not a rest day ∧ not paused. Unconfirmed registrants' entries are saved but they are not "expected".
- **BR-J-06** **Content visibility**: *Standard* answers are visible to holders of `journal.content.view` whose scope includes the person, **limited by the policy depth** (default 1 = the direct leader only; pastoral roles are unlimited). *Restricted* answers are visible to the direct leader and pastoral roles only. *Confidential* answers are visible to pastoral roles only. Status is not content: branch leaders can always see status.
- **BR-J-07** "Missed" is informational. Consecutive misses ≥ threshold create a follow-up **suggestion** for the direct leader. No automated message is ever sent to the person's wider leadership about their spiritual state.
- **BR-J-08** Excusals (a personal pause or a ministry rest day) remove the day from "expected" and are never counted as missed.
- **BR-J-09** Proxy submissions are allowed for a leader over their direct group only, labelled as proxy, and audited.
- **BR-J-10** Changing the journal form publishes a new version. Existing entries keep the version they were answered with. Fields are retired, never deleted.
- **BR-J-11** **Entries follow the relationship at the time they were written.** A (non-pastoral) leader can read an entry only if they are the person's current leader within the content-depth policy **and** the entry's ledger snapshot places the person in their group on that date. After a transfer, the new leader sees entries from the transfer date onward, and the previous leader loses content access (status history stays in reports). Pastoral roles are unaffected. A setting can instead give the new leader the full history.

### Prayer chain
- **BR-PR-01** Slots in one chain never overlap. A person cannot hold overlapping active assignments across chains.
- **BR-PR-02** Confirmation can be given from creation up to the slot start. Check-in is allowed from start − 15 min to end. Completion is allowed from start to end + grace.
- **BR-PR-03** Completion after end + grace is accepted but flagged *late*.
- **BR-PR-04** At end + grace with no completion, the system sets **Needs follow-up** and notifies the coordinator. Only a coordinator can resolve it to *Completed (verified)*, *Missed* or *Excused*.
- **BR-PR-05** A substitute creates a new assignment linked to the original. The original becomes *Replaced* and does not count against the person if the replacement happened before the slot started.
- **BR-PR-06** A slot spanning midnight belongs to the chain date of its **start** instant.

### Devotional / worship
- **BR-D-01** One active assignment per (gathering, role, person). A person may hold several roles in the same gathering (e.g. worship leader + lead vocal).
- **BR-D-02** A person assigned to overlapping gatherings produces a warning, not a hard block.
- **BR-D-03** Generation is idempotent per (schedule, date). Regenerating never overwrites manual edits.
- **BR-D-04** A decline triggers substitute suggestions: same role, active team member, not unavailable, not already serving that gathering.
- **BR-D-05** Cancelling a gathering cancels its assignments and notifies confirmed members.

### Access
- **BR-A-01** Deny by default. Every read and write goes through the policy layer with the actor's scopes.
- **BR-A-02** System administration permissions never imply pastoral-content permissions.
- **BR-A-03** Records outside the actor's scope return **404, not 403**, so their existence is not revealed.
- **BR-A-04** Every read of sensitive content is recorded in the access log.

---

## 6. Important assumptions (please confirm)

| # | Assumption | If wrong… |
|---|---|---|
| A1 | The ministry operates in the **Philippines** (inferred from the example names): timezone `Asia/Manila`, PH Data Privacy Act, PH mobile formats, SMS through PH gateways | Change the defaults; privacy doc switches to the relevant law (e.g. GDPR) |
| A2 | **Every level journals**, leaders included, so "expected" today ≈ 1,884, not 1,728 | Configure `journal_expected` per level |
| A3 | One ministry per deployment (no multi-church SaaS for now) | If you intend to sell/host for other churches, decide **before** Phase 8 (see README decision D3) |
| A4 | Journal review by the direct leader is expected daily (~12 reads per leader per day) | If review is optional, the "Awaiting review" dimension is hidden |
| A5 | Journal content default visibility = **direct leader + pastoral roles** | Configurable depth (e.g. Primary Leaders read their whole branch) |
| A6 | Portal users have email addresses (magic-link login) | Add SMS OTP login (V1, costs money) |
| A7 | Minors may participate (youth) | If not, the guardian-consent flow is disabled |
| A8 | English UI initially | Filipino strings in V1 |
| A9 | Prayer is honour-based: the system records what people report and verifies nothing | — |
| A10 | Existing data lives in spreadsheets and will be imported | If there is an existing database, add a migration adapter |

---

## 7. Edge cases & designed handling

| # | Edge case | Handling |
|---|---|---|
| E1 | **Person changes leader** | Effective-dated move; history row; today's and future ledger rows re-attributed; past days keep the old leader; both leaders notified |
| E2 | **Leader becomes inactive** | Blocked until their direct group is reassigned (wizard). An optional "temporarily under their own leader" choice raises a follow-up for the Primary Leader |
| E3 | **Ministry membership ≠ spiritual leader** | Separate tables; the profile shows both clearly ("Leader: John · Primary: Michael · Serves in: Worship › Music › Team B") |
| E4 | **Duplicate names** | Allowed; the selector and profile always show a disambiguator (leader name, ministry, person code); never match on name alone |
| E5 | **Duplicate / shared mobile numbers** | Phone is not unique. Identification by phone requires first-name confirmation; if several people share phone + first name, fall back to the personal link or leader help |
| E6 | **No mobile number** | Register without a phone; recognition via device key or personal link; the leader can submit by proxy |
| E7 | **Wrong leader selected at registration** | Person is Unconfirmed → the wrong leader taps "Not mine" → a request goes to the admin queue with the suggested correct leader; entries are kept and re-attributed when fixed |
| E8 | **Journal submitted twice** | Same idempotency key → the original result is returned. Otherwise, remembered device within the edit window → edit with revision; any other device → "Already received today at 7:14 AM ✓" (content never shown) |
| E9 | **Submitted after midnight** | Late-window choice "for yesterday / for today" (BR-J-02) |
| E10 | **Different timezone (members abroad)** | MVP: ministry timezone plus the late-window choice covers most cases; V1: per-person timezone for date attribution |
| E11 | **Prayer slot crosses midnight** | Stored as UTC start/end instants; belongs to the chain date of its start; displayed with both dates if needed ("Sat 11:00 PM – Sun 1:00 AM") |
| E12 | **Person misses a prayer slot** | Needs follow-up (auto) → coordinator decides Missed / Excused / Completed (verified). Nothing negative is final without a human |
| E13 | **Substitute takes over** | New linked assignment; original *Replaced*; action links of the original are revoked; the substitute gets their own link |
| E14 | **Worship member unavailable** | Declines via link or is marked unavailable → substitute suggestions → coordinator assigns → new link sent |
| E15 | **Leader removed with people assigned** | Same as E2; DB-level guard prevents removing a hierarchy node that has children |
| E16 | **Archived person** | Hidden from lists, selectors, reminders and expected counts; history retained; action tokens and device keys revoked |
| E17 | **Anonymous prayer request** | Stored with `is_anonymous`; the submitter's identity is stored only if needed for follow-up and hidden from all but pastoral roles; configurable to not store identity at all |
| E18 | **Confidential journal answer** | Field sensitivity *confidential* → pastoral roles only; leaders see "1 private answer shared with the pastoral team"; every read is logged |
| E19 | **Levels beyond 12/144/1,728** | Unlimited depth; level names configured by depth; branching unconstrained (a soft warning above a configurable group size, e.g. > 12) |
| E20 | **Shared / borrowed phone** | "This isn't my phone" checkbox → no device key, no draft stored; identity asked every time |
| E21 | **Network drops mid-submit** | Answers kept in memory/session storage; retry with the same idempotency key; exactly one entry is created |
| E22 | **Form changed while someone is filling it** | Submit carries the form version id; an old but still-valid version is accepted, and a retired required field is ignored |
| E23 | **Leader QR leaked publicly (e.g. posted on social media)** | Rate limits; new registrations stay Unconfirmed; the leader rotates the code in one click |
| E24 | **Person on leave / sick / travelling** | Personal pause with a date range → Excused; follow-up suggestions suppressed |
| E25 | **Church-wide retreat, holiday, typhoon, power outage** | Admin declares a rest day (or retroactively excuses a day) → nobody is Missed |
| E26 | **Leader on leave, journals unreviewed** | V1 review delegation; MVP: the Primary Leader can review in the absent leader's place with explicit permission |
| E27 | **Person relocates to another primary branch** | Leader change across branches requires a Primary Leader or Pastor whose scope covers both, or an Admin |
| E28 | **Deceased member** | Archive reason "deceased" → immediate suppression of all notifications and reminders; handled respectfully in UI copy |
| E29 | **Person serves in two ministries with conflicting morning duties** | Devotional overlap warning (BR-D-02) |
| E30 | **Name change (e.g. marriage)** | Edit is audited (the previous name is kept in audit history); an optional searchable `former_names` field (V1) lets people still be found under their old name |
| E31 | **Person was never expected but submits anyway** | Ledger row created with `is_expected = false`; entry saved and shown to the leader; not counted in completion % |
| E32 | **Concurrent hierarchy edits by two admins** | Hierarchy writes are serialised with a transaction-level advisory lock; the second operation re-validates |
| E33 | **Import of 1,800 people with messy leader names** | Import preview resolves leaders by code/phone/exact name; unresolved rows are flagged, never guessed |
| E34 | **Minor registers** | Birth year makes them under 18 → guardian consent step (setting-controlled); limited data collected |
| E35 | **Device key stolen (phone lost)** | Leader/admin revokes the person's device keys from their profile; a new personal link is issued |
