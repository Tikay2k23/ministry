# Phase 4 — User Experience

> Part of the **Ministry System — Product & Architecture Blueprint**.

---

## 1. Design principles

1. **Names before numbers for leaders; numbers before names for executives.** A leader of 12 wants to see *John, Mary, Peter*. A pastor over 1,900 wants *1,612 of 1,884*, with names one tap away.
2. **Calm by default.** Neutral grey for "Not yet", warm sage for "Received", soft amber for "Needs attention". **Red is reserved for system errors and security**, never for a person.
3. **One primary action per screen.** Especially on public forms.
4. **Progressive disclosure.** Today → list → person → entry. Summaries first, detail on demand.
5. **Respect before accountability.** No public rankings. Streaks are visible to the leader only (a setting). Participants only ever see a gentle confirmation of their own submission.
6. **Mobile-first for participants, responsive for the portal.** Public forms are designed at 360 px first. The portal is designed at 1280 px and degrades cleanly to tablet and phone.
7. **Never lose someone's words.** Journal text is kept through network failures, and there is always a clear "received" confirmation.

---

## 2. Visual language

| Element | Direction |
|---|---|
| **Typography** | UI text and tables: *Inter* (system-font fallback), 16 px base in the portal, **18 px on public forms**, line height 1.5, tabular numerals for counts. Page titles, public greetings and big numbers: **Nunito** (700–800), a rounded sans that echoes the rounded lettering of the GenTouch logo |
| **Colour** | Derived from the GenTouch logo; see **Brand** below. Primary actions use the logo's deep green; lime is an accent only; the logo red stays in the logo. Status: Received `deep green on leaf tint` · Late `amber #B7862C` · Not yet `neutral outline #8A8F98` · Missed `muted clay #A0674F` (not red) · Excused `slate #6B7A8F` · Needs follow-up `amber dot`. The listed hues are for icons/dots; chip **text** uses a darker shade of each hue (≥ 4.5 : 1) |
| **Layout** | 8-px spacing grid; generous whitespace; max content width 1200 px; **tables for lists, not card grids**; cards only for at most 3 summary tiles on the dashboard |
| **Shape** | 10 px radius, 1 px hairline borders, almost no shadow, **no gradients** |
| **Icons** | lucide, 20 px, always paired with a text label |
| **Motion** | 150 ms fades/slides only; respects `prefers-reduced-motion` |
| **Status chips** | Icon + text + colour (never colour alone), e.g. `✓ Received`, `◷ Not yet`, `⚑ Follow up` |
| **Dark mode** | Portal, V1 (tokens designed for it from day one) |
| **Accessibility** | WCAG 2.2 AA contrast; 48 px targets on public pages, 40 px in the portal; visible focus rings; form errors announced to screen readers; no information conveyed by colour alone |

### Brand: Generation Touch Harvest International (GenTouch)

The logo tells the story this system supports: a **sprouting G** (growth, generations) and a **fingerprint T** (the personal touch). The tagline, ***There's a Nation Inside of You!***, is the multiplication vision the leadership tree models (1 → 12 → 144 → 1,728 → …).

| Asset | Use |
|---|---|
| **Full logo** (mark + "GenTouch" wordmark + tagline) | Sign-in page, first-visit public header, printed QR cards/posters, report/PDF header |
| **Mark only** (G + fingerprint T, no text) | Portal sidebar, compact public header (≥ 32 px) |
| **Simplified flat mark** (no bevel/gloss, fewer fingerprint ridges) | Favicon, PWA/home-screen icon (192/512 px, maskable), push-notification icon. **Still to be produced**: the glossy 3D rendering and tagline are unreadable below ~64 px |
| **Names** | Full: *Generation Touch Harvest International*. Short: **GenTouch** (home-screen label, email "from" name, SMS sender id) |

**Rules:** the logo keeps its original glossy style, but the **UI around it stays flat** (no gradients or bevels), so the logo is the single rich element on screen. Never recolour, stretch, or place the logo on busy backgrounds. Keep clear space of at least one leaf's height around it.

**Implementation note (2026-09-18).** The ministry supplied the full logo, so `BrandMark` is no longer a text placeholder: `public/brand/gentouch-logo.png`, the original artwork at 1254 px square on a transparent background. `src/components/brand/brand-mark.tsx` renders it through `next/image` at a `size` in pixels (the rendered height), asking for four times that many pixels so it stays sharp in print: 44 px in the public header, 52 px in the portal sidebar, 168 px on the sign-in page, and 76 / 88 / 190 px on the wallet card, the table tent and the poster. `withTagline` repeats the tagline as text underneath, because the tagline drawn along the G only becomes readable at poster size; the image itself is named just "GenTouch", so a screen reader hears each once. `src/app/icon.png` (512 px) and `apple-icon.png` (180 px, on white) are generated from the same file for the browser tab and the phone home screen.

**Still to be produced by a designer**, and the reason the table above asks for them: a **mark-only** variant for the sidebar and compact header, and a **simplified flat** variant for the icons. Neither can be cut from the supplied artwork — the wordmark arcs across the top of the G and the tagline runs along its stroke, so both are part of the drawing. Until then the full logo is used everywhere, which means that below roughly 120 px the wordmark and tagline are decorative rather than readable. A **vector original** (SVG, AI, EPS or vector PDF) is also still wanted for large-format printing.

**Colour tokens** (values approximated from the supplied image; replace with the designer's exact values when the original files arrive):

| Token | Value | Role | Contrast |
|---|---|---|---|
| `brand-deep` | `#1F5F24` (logo outline & wordmark green) | Primary buttons, links, focus ring, active nav | 7.7 : 1 on white ✓ AAA |
| `brand-deep-hover` | `#174A1C` | Hover / pressed | — |
| `brand-leaf` | `#7CC63A` (logo lime) | **Accent only**: progress fills (with a deep-green edge), selected-row marker, illustrations; primary colour in dark mode | 2.1 : 1 on white ✗ **never text or thin lines on light backgrounds** |
| `brand-leaf-tint` | `#EEF7E4` | Soft surfaces: "Received" chip background, success screen, selected rows | — |
| `brand-touch` | `#E3261E` (logo red) | **Logo only** (at most one small brand accent per page, never near statuses) | — |
| `ground` · `ink` · `muted` | `#FAFAF7` · `#1F2328` · `#5C6370` | Background · text · secondary text | ink ≈ 15 : 1 |
| `error` | `#B42318` | Form and system errors. Deliberately deeper than the brand red, so errors never look like branding and the brand never looks like an error | 6.6 : 1 ✓ |

**Motifs, used sparingly:** a single sprout leaf as the "received / growth" moment on the journal success screen; faint fingerprint arcs as a background pattern on the sign-in page only.

### Language guide
| Avoid | Use instead |
|---|---|
| "Missing" (during the day) | **"Not yet"** |
| "Missing" / "Failed" (after the day closes) | **"No journal received"** (UI) / "Missed" (reports only) |
| KPI, score, performance, compliance | **Consistency**, rhythm |
| Top performers / worst groups | **Groups to celebrate** / **Groups that may need encouragement** |
| Overdue, delinquent | **Needs follow-up** |
| Users (for members) | **People** |
| Submit | **"Send my journal"**, **"I'll be there"**, **"I've finished praying"** |
| Rejected | **"Not mine"** (registration), **"Can't make it"** (assignment) |

---

## 3. Information architecture

### Public (no login)
```
/j                    Daily Journal (general QR)
/j/{code}             Daily Journal (leader QR)
/k/{token}            Remember this phone (personal link)
/pray/{code}          Prayer chain page
/a/{token}            My assignment (prayer slot / serving)
/privacy              Privacy notice
```

### Portal
```
/app                              Dashboard — "Ministry Today" (role-adaptive)
/app/follow-ups                   Follow-ups (care list, all modules)
/app/people                       Directory
   /new · /review · /import · /{id} [Overview · Leadership · Serving · Journal · Prayer · Notes · History]
/app/leadership                   Tree explorer
   /{personId}                    Branch view
   /requests                      Leader change requests
/app/journal                      Today (my people / branch)
   /review                        Review queue
   /{personId}/{date}             Journal entry
   /form                          Journal questions
   /calendar                      Rest days & pauses
/app/prayer                       Chains
   /{chainId}                     Chain board (day timeline)
   /{chainId}/setup               Schedule & commitments
/app/devotional                   Calendar
   /{gatheringId}                 Roster
   /teams · /schedules            Teams & roles · Rotations
/app/ministries · /{id}           Ministries, departments, teams
/app/reports · /{key}             Report catalog · report viewer
/app/notifications                Inbox (+ templates for admins)
/app/admin/users · /{id} · /roles Users & Permissions
/app/admin/settings/{section}     Settings (General, People fields, Leadership levels, Journal policy,
                                  Prayer defaults, Public forms, Privacy & retention, Notifications)
/app/admin/links                  QR codes
/app/admin/audit                  Audit log
/app/admin/health                 System health (jobs, providers)
/app/account                      My account (profile, sessions, 2FA, notification preferences)
```

### Navigation
Your suggested navigation is kept, with one addition: **Follow-ups**, placed directly under Dashboard. It is the leaders' most important daily list, and it spans journal, prayer and serving. QR codes, Audit and System health sit under **Settings** to keep the top level short.

```
Desktop sidebar (items hidden without permission)     Mobile portal bottom bar
──────────────────────────                            ─────────────────────────────
 ◉ Dashboard                                           Today · Journal · People · Prayer · More
 ⚑ Follow-ups            (badge: open count)
 ─ SHEPHERDING
   People
   Leadership
   Daily Journal
 ─ RHYTHMS
   Prayer Chain
   Devotional
 ─ ORGANISATION
   Ministries
   Reports
 ─ ADMINISTRATION
   Notifications
   Users & Permissions
   Settings  (QR codes · Audit · Health)
```
A **scope switcher** in the header (e.g. `All ministry ▾` / `Michael's branch` / `My group`) is shown only to users with more than one scope.

---

## 4. Key wireframes

### 4.1 Public journal: returning person (phone, 360 px)
```
┌────────────────────────────────────┐
│  [logo] GenTouch       Daily Journal │
│                                      │
│  Good morning, John                  │   ← serif greeting, first name only
│  Saturday, September 12              │
│  Leader: Mark S.     Not your leader?│
│ ──────────────────────────────────── │
│  What did you read today?            │
│  ┌──────────────────────────────────┐│
│  │ John 3:16–21                     ││   ← scripture input, helper text below
│  └──────────────────────────────────┘│
│  What is God speaking to you?        │
│  ┌──────────────────────────────────┐│
│  │                                  ││   ← auto-growing textarea
│  └──────────────────────────────────┘│
│  Did you pray today?   ( Yes )( No ) │
│  🔒 Anything for the pastoral team?  │   ← confidential field, labelled
│  ┌──────────────────────────────────┐│
│  └──────────────────────────────────┘│
│                                      │
│ ┌──────────────────────────────────┐ │
│ │        Send my journal           │ │   ← sticky bottom, 56 px
│ └──────────────────────────────────┘ │
└────────────────────────────────────┘
```

### 4.2 Public success
```
┌────────────────────────────────────┐
│               ✓                      │
│        Journal received              │
│   Saturday, September 12 · 7:14 AM   │
│   Mark will see it today.            │
│                                      │
│   "Your word is a lamp to my feet."  │   ← optional verse of the day (setting)
│                        Psalm 119:105 │
│                                      │
│   [ Add Journal to home screen ]     │   ← shown after 2nd submission
│   [ Done ]                           │
│                                      │
│    There's a Nation Inside of You!   │   ← GenTouch tagline, small footer
└────────────────────────────────────┘
```

### 4.3 Leader: my people today (portal, phone or desktop)
```
Daily Journal · Saturday, September 12                          [ Review 3 ]
My group  ·  9 of 12 received  ·  deadline 11:59 PM
━━━━━━━━━━━━━━━━━━━━━━━━━━━━░░░░░░░░░  75%

 Name              Today            Review          7 days
 John Santos       ✓ Received 6:40  ● Awaiting  →   ●●●●●●●
 Mary Cruz         ✓ Received 7:02  ✓ Reviewed      ●●●●●○●
 Joshua Lim        ✓ Received 7:15  ● Awaiting  →   ●●●●●●●
 Peter Reyes       ◷ Not yet                        ●●○○○●○   ⚑ 3 days
 Anne Dela Cruz    ◷ Not yet                        ●●●●●●○
 …
 New — please confirm:  Carlo Mendoza registered under you (Sep 11)   [Confirm] [Not mine]
```

### 4.4 Command Center (pastor, desktop)
```
Ministry Today · Saturday, September 12                          Scope: All ministry ▾

 DAILY JOURNAL                PRAYER CHAIN                   MORNING DEVOTIONAL
 1,612 of 1,884 received      18 of 24 hours completed        Team B · 6:00 AM
 ━━━━━━━━━━━━━━━░░ 86%        ◉ Now: 7–8 AM · Anne            5 confirmed · 1 pending
 272 not yet · 2 hrs left     1 needs follow-up · 5 upcoming  Keyboard: Mark (pending)

 NEEDS ATTENTION
  ⚑ 14 people haven't journaled for 3+ days               View →
  ● 86 journals awaiting review (8 older than 2 days)      View →
  ⚑ Prayer slot 2–3 AM wasn't confirmed (Peter)            Follow up →
  ● Keyboard for tomorrow hasn't responded                 Remind →

 LEADERSHIP GROUPS (today)                          JOURNAL · LAST 30 DAYS
  Primary leader        Received    7-day            ▁▃▅▆▆▇▆▇▇▆▅▆▇▇█▇▆▆▇▇▇▆▇▇▇▆▇▇▇▆
  Michael R.   142/156  91%  ●●●●●●○                  avg 89% · steady
  Samuel T.    131/156  84%  ●●●●●○○
  …           (sorted by name, not by rate)
```

---

## 5. Page specifications

**Shared state patterns (all portal pages):**
- **Loading:** layout-matching skeletons via React Suspense per section (the page shell renders instantly and widgets stream in). No full-page spinners.
- **Error:** inline panel "Something went wrong loading this section" + *Try again* + a short request id for support. Other sections keep working.
- **Not permitted / out of scope:** a standard 404 "We couldn't find that page" (never "access denied" for records, BR-A-03).
- **Offline (public):** banner "You're offline. Your answers are safe; we'll send them when you're back."

### Public pages

#### P1 · Journal: welcome & identify (`/j`)
- **Purpose:** Get the participant to the form in as few steps as possible.
- **Users:** Any participant.
- **Components:** Ministry header (logo, name, date); greeting; two large choices, "I've journaled here before" and "This is my first time"; identify form (mobile input with +63 prefix, first name); "This isn't my phone" checkbox; privacy link.
- **Actions:** Identify → form. Register → P3a. "Ask my leader for my personal link" (explains what to do).
- **Filters:** —
- **Permissions:** Public; rate-limited; form session token.
- **Empty:** —
- **Loading:** Inline "Checking…" on the button (no page loader).
- **Error:** "We couldn't confirm those details. Check your number and first name, or ask your leader for your personal link." Rate-limited: "Too many tries — please wait 15 minutes."

#### P2 · Journal: leader QR landing (`/j/{code}`)
- **Purpose:** Same as P1 with the leader already known.
- **Users:** Members of that leader's group.
- **Components:** "Journaling with **Mark S.**'s group", then the P1 identify choices. Returning person whose recorded leader differs: "Your leader is **Anna R.** This code belongs to **Mark S.** Is Mark your leader now?" with **[Keep Anna]** and [Ask to move to Mark] (creates a request).
- **Actions:** Identify, register (leader preselected), request leader change.
- **Permissions:** Public.
- **Error:** Retired code → "This QR code has been replaced. Please ask your leader for the new one." Unknown code → P10.

#### P3 · Journal form (`/j`, identified)
- **Purpose:** Capture today's journal in under 30 seconds for returning people.
- **Users:** Identified participant.
- **Components:** Greeting and date; leader line with "Not your leader?" (opens a searchable bottom sheet); **date choice** ("For yesterday, Sep 11" / "For today, Sep 12") shown only in the late window; fields rendered from the published form version (one column, large inputs, auto-growing text areas, scripture helper, yes/no toggles, choice chips); 🔒 label on confidential fields ("Shared only with the pastoral team"); character counter near limits; sticky **Send my journal**.
- **Actions:** Send; change leader (→ request); edit (if already sent, device key, within window).
- **Permissions:** Participant identity.
- **Empty:** Already submitted → "Your journal for today was received at 7:14 AM ✓" + [Edit my journal] if allowed.
- **Loading:** Button "Sending…" (disabled; idempotency key protects retries).
- **Error:** Field-level messages under each field, plus a summary at the top with anchor links. Network failure → answers kept, "Try again". Form updated → "The journal questions were just updated — your answers are kept where possible."

#### P3a · Registration (first time)
- **Purpose:** Create the person with minimal data and consent.
- **Components:** First name, last name, preferred name (optional), mobile (optional, but encouraged), leader (preselected on leader QR, otherwise searchable selector: type 2+ letters, up to 8 results showing name plus a hint such as ministry), ministry (only if required by settings), birth year (only if minors setting on), privacy summary + consent checkbox (link to full notice); guardian step if under 18.
- **Actions:** Continue → journal form.
- **Error:** Turnstile appears only if risk-flagged. Exact phone + name match → "Looks like you've journaled with us before" → identify.

#### P4 · Journal success
- **Purpose:** Certainty that it arrived, plus warmth.
- **Components:** Check mark, "Journal received", date and time, "Mark will see it today", optional verse of the day, add-to-home-screen prompt (after the 2nd submission), Done.
- **Error:** —

#### P5 · Remember this phone (`/k/{token}`)
- **Purpose:** Restore recognition on a new or reset phone.
- **Components:** "Remember this phone for **John S.**?" [Yes, this is my phone] / "This isn't me".
- **Actions:** POST confirm → sets device key → redirect to `/j` (token removed from URL).
- **Error:** Expired/used → "This link has expired. Ask your leader for a new one."

#### P6 · Prayer chain page (`/pray/{code}`)
- **Purpose:** Show the whole day of the chain, so anyone can see where the gaps are and take one.
- **Components:**
  - Chain name and description; a day picker with the day before and after.
  - **The hours** — every hour of the chosen day as a card: *Open* / *Open now* / *Praying now* / *Taken* / *Prayed* / *Covered* / *Not filled*, with **Choose this hour** on any that is still free. Filters: all hours · still open · my hour. Three columns on a wide screen, one on a phone.
  - **This hour** — the running hour and who is praying, when the chain publishes first names.
  - **Today** — covered of total with a bar, and the counts of open, prayed and not filled.
  - **Your hour** for a remembered device: the one action that is currently valid (Confirm / I'm praying now / I've finished), or an invitation to choose one.
- **Actions:** Take an hour (identify first if we don't know you), move to another one, confirm, check in, complete, can't make it.
- **Permissions:** Anyone may read the day. Taking an hour needs identity and the chain's `allow_self_signup`; every rule is re-checked on the server (docs/05 W11).
- **Privacy:** First names only, and only when the chain publishes them. An hour that ended without anyone marking it finished reads as *Covered*, never *Missed* — that judgement is the coordinator's (BR-PR-04) and stays on the board.
- **Empty:** "There are no hours to show for this day"; with the filter on, "Every hour of this day is covered. Thank you!"
- **Error:** Retired code → P10-style message.

#### P7 · Prayer assignment (`/a/{token}`)
- **Purpose:** Act on one slot without login.
- **Components:** Slot card: chain, local date and time (both dates shown if crossing midnight), state; **one primary button** appropriate to the window (Confirm → "I'm praying now" → "I've finished praying"); after completion, a collapsed *"Share a prayer report or testimony (optional)"* form; secondary link "I can't make it" (reason select + note).
- **Actions:** Confirm, check in, complete (+ report), can't make it.
- **Loading/Error:** Button states; outside window → "You can confirm until 2:00 AM" / "Check-in opens at 1:45 AM"; cancelled or replaced → "This slot has been reassigned — thank you!"

#### P8 · Serving assignment (`/a/{token}`)
- **Purpose:** Accept or decline a devotional role.
- **Components:** "Morning Devotional · Saturday, September 12 · 6:00 AM"; role (Keyboard) and team (Team B); roster first names by role; **[I'll be there]** / [I can't make it] (+ note).
- **Actions:** Respond; change response until the lock time (e.g. 12 hours before), after which "Please contact your coordinator".
- **Error:** Cancelled gathering → "This devotional was cancelled: {reason}".

#### P9 · Privacy notice (`/privacy`): versioned, plain-language notice; DPO contact; what is collected, why, who sees it, how long it is kept; rights and how to exercise them.

#### P10 · Link problem: friendly generic page for unknown/expired links, with no detail about why (prevents probing).

### Portal pages

#### A1 · Sign in
- **Purpose:** Passwordless access for leaders; strong access for sensitive roles.
- **Components:** Full GenTouch logo and tagline over a faint fingerprint-arc background; email field → "Check your email" screen; TOTP code screen (sensitive roles); first-time 2FA setup (QR + backup codes); optional Google button.
- **Error:** Generic messages; rate-limit notice; expired link → request a new one.

#### A2 · Dashboard: "Ministry Today"
- **Purpose:** Answer "how is the ministry today and who needs care?" in 10 seconds.
- **Users:** Everyone with a portal account. Content adapts to role and scope.
- **Components:** Header with date and scope switcher; up to **3 summary tiles** (Journal · Prayer · Devotional, each shown only if permitted); **Needs attention** list (max 6 items, each linking to a filtered list); Leadership groups table (branch/executive), sorted by name; 30-day journal trend sparkline; upcoming devotional (next 3 days); for Leaders the main block is **My people today** (4.3).
- **Actions:** Drill into any number; switch scope; review next.
- **Filters:** Scope; date (today default, with a quick "yesterday").
- **Permissions:** Tiles require the module's `*.view` / `journal.status.view` in scope.
- **Empty:** New system → "Welcome. Start by importing people and building your leadership structure" with a checklist. No people in scope → "No one is assigned to you yet."
- **Loading:** Tiles stream independently.
- **Error:** Per-tile error panel.

#### A3 · Follow-ups
- **Purpose:** One caring to-do list across modules.
- **Users:** Leaders, primary leaders, coordinators, pastoral staff.
- **Components:** Tabs *Open / In progress / Resolved*; rows: person, reason chip (e.g. "No journal · 3 days", "Prayer slot not confirmed", "Declined Keyboard"), since, assigned to; side sheet with context, quick actions (call/message links, mark contacted, resolve with note).
- **Filters:** Kind, assignee (me/all in scope), age.
- **Permissions:** `care.view` (+ `care.pastoral.view` for pastoral items; otherwise they are hidden entirely).
- **Empty:** "All caught up. No one needs follow-up right now."

#### A4 · People directory
- **Purpose:** Find anyone in scope quickly.
- **Components:** Search box (name / phone / person code); filter bar (leader, primary leader, ministry, department, team, level, status, designation, registration); table (name + preferred name, leader, primary leader, ministry, status, last journal); server-side pagination (25/50/100); column sort; bulk-select actions (export, add to team) where permitted; "Add person".
- **Filters:** As listed; filter state lives in the URL.
- **Permissions:** `people.view`; phone/email columns only with `people.contact.view`.
- **Empty:** No matches → "No one matches these filters" + clear filters.
- **Loading:** Table skeleton rows; search debounced at 250 ms.

#### A5 · Person profile
- **Purpose:** Everything appropriate about one person, organised by tab.
- **Components:** Header (name, person code, status chips, derived labels like "Leader of 12 · Worship Team B"); **Chain of leadership** breadcrumb ("Pastor Ed › Michael R. › Mark S. › **John**"); tabs:
  - *Overview:* contact (permission-gated), designations, joined date, consent status.
  - *Leadership:* direct leader, direct group (with counts), history timeline, change leader.
  - *Serving:* ministry memberships, teams, serving roles, upcoming assignments.
  - *Journal:* 30-day dot calendar, consistency (7/30/month), current streak, list of days with status; entry links only if content permitted.
  - *Prayer:* commitments and recent slots.
  - *Notes (V1):* leadership/pastoral notes by permission.
  - *History:* audit entries.
- **Actions:** Edit, archive, change leader, issue personal link, revoke device keys, excuse/pause journal, proxy submit, add to team, invite to portal.
- **Permissions:** Each tab and action individually gated.
- **Empty:** Per tab ("No serving roles yet").
- **Error:** 404 if out of scope.

#### A6 · New registrations & duplicates (`/people/review`)
- **Purpose:** Keep the directory clean.
- **Components:** Tab *New registrations* (person, chosen leader, registered at, first journal?, **Confirm / Not mine / Edit**); tab *Possible duplicates* (pair view side by side, reasons, **Merge / Not duplicates**).
- **Permissions:** Registrations: receiving leader or `people.registrations.confirm` in scope. Duplicates: `people.merge`.
- **Empty:** "Nothing to review."

#### A7 · Import people
- **Purpose:** Bring existing spreadsheets in safely.
- **Components:** Step 1 download template + upload; Step 2 column mapping; Step 3 preview with row outcomes (valid / warning / error / possible duplicate) and summary counts; Step 4 commit with progress; result report downloadable.
- **Permissions:** `import.manage`.
- **Error:** File-level errors (encoding, headers) block; row errors never auto-fixed or guessed.

#### A8 · Leadership tree explorer
- **Purpose:** See and shape the structure.
- **Components:** Lazy-loaded indented tree (not a zoomable org chart, which becomes unreadable beyond ~200 nodes): each row shows name, level name, direct count, branch size and today's journal %; expand/collapse; search to jump to a person (auto-expands their path); side panel with person summary and actions (move, reassign group, set "accepts members"); soft warning when a group exceeds the configured size.
- **Actions:** Move (dialog: choose new leader, "with their group" vs "leave their group with…", reason), reassign group, place unplaced people.
- **Permissions:** `hierarchy.view` scoped; actions `hierarchy.manage`.
- **Empty:** "No leadership structure yet. Import people or place your first leaders."

#### A9 · Branch view (`/leadership/{personId}`)
- **Purpose:** A Primary Leader's (or any leader's) whole branch at a glance.
- **Components:** Header with leader and branch size; table of direct sub-leaders: group size, received today, 7-day and 30-day consistency, open follow-ups; toggles: today / 7 days / 30 days; "Groups to celebrate" and "Groups that may need encouragement" (V1, gentle phrasing, top 3 each).
- **Permissions:** `journal.status.view` with the branch in scope.

#### A10 · Leader change requests
- **Purpose:** Handle requests from public forms and colleagues.
- **Components:** List (person, from → to, source, date, note); approve / reject with note; bulk approve for admins.
- **Permissions:** Receiving leader, or `hierarchy.requests.decide` covering both leaders.
- **Empty:** "No pending requests."

#### A11 · Journal: Today
- **Purpose:** Daily view of submissions in scope, arranged the way the ministry is: all of it, then one Primary Leader, then one of their leaders, then a person (4.3 for leaders).
- **Components:**
  - **Breadcrumb** — All ministry › Primary Leader › Direct Leader, each step a link back out; a leader who cannot see the whole ministry reads "Everyone you can see" instead.
  - **Primary Leader cards** — one per branch with anyone on that day, showing received of expected and what is still out. Counted from the branch the ledger recorded for the day, so a past day stays right after someone moves (docs/03 §4.7). Shown when there is more than one branch to choose between.
  - **Filters** — day, Primary Leader, Direct Leader (the leaders inside the chosen branch), role, ministry, status, and a name search. Inline above the table on a tablet and up; behind one **Filters** button, in a sheet, on a phone.
  - **Summary cards** — Received (with late), Not yet, No journal, Excused, each with its share of the people expected; clicking one filters the table.
  - **Chips** — Everyone · Received late · Needs review · With a photo, each with its own count over the same filtered people.
  - **Table** — name, role, ministry, the day's status and time, the leader of the day, whether a photo came with it, seven-day dots, and an action. Sortable by name, status, leader or when it arrived; 25, 50 or 100 rows a page. On a phone the same rows become cards.
- **Actions:** Open entry, review, excuse, proxy submit, message (tel:/sms: links).
- **Permissions:** `journal.status.view` decides who is counted at all; a mobile number is only searchable by someone with `people.contact.view` for that person; the photo column and chip say only that a photo came with the journal, which is part of the day’s status — the photo itself is behind `journal.proof.view` and is only ever fetched when the entry is opened (docs/02 §4). Every filter, the sort and the page are applied in the database, so the page never holds people the reader may not see.
- **Empty:** "No one in your group is expected to journal today" (rest day → "Today is a rest day"); with filters on, "No one matches these filters" and a way to clear them.

#### A12 · Review queue
- **Purpose:** Fast, respectful reading, one entry at a time.
- **Components:** Entry reader (large readable text, answers in form order, hidden-answer notice such as "1 private answer shared with the pastoral team"); side: person context (7-day dots, last review note); optional private comment; **Mark reviewed & next** (keyboard: `J/K` navigate, `R` review); "Flag for follow-up".
- **Permissions:** `journal.review` + content visibility.
- **Empty:** "You're all caught up. 🙏"

#### A13 · Journal entry (`/journal/{personId}/{date}`)
- **Purpose:** Read one entry, with revisions and reviews.
- **Components:** Meta (received time, on-time/late, channel incl. "via proxy by Mark"), answers, revision indicator ("edited at 7:30 AM"), reviews list, review form.
- **Permissions:** Content rules (BR-J-06). Every view is logged.
- **Error:** 404 when not permitted.

#### A14 · Journal questions (form builder)
- **Purpose:** Change questions without code.
- **Components:** Two-pane: field list (drag to reorder, toggle on/off, duplicate) and field editor (type, label, help text, required, sensitivity with an explanation of who will see answers, options for choice types); **live phone preview**; "Unpublished changes" bar with **Publish** (shows the diff against the current version).
- **Permissions:** `forms.manage` to edit; `forms.publish` to publish.
- **Error:** Validation list (duplicate keys, empty options).

#### A15 · Rest days & pauses
- **Purpose:** Prevent unfair "missed" days.
- **Components:** Month calendar with rest days; add rest day (kind, note, applies to journal); list of active personal pauses (person, dates, reason) with end/cancel.
- **Permissions:** `journal.settings.manage` (rest days), `journal.excuse` (pauses, scoped).

#### A16 · Prayer: chains
- **Purpose:** Overview of all chains.
- **Components:** Table: name, type, status, today's coverage (covered/total, completed), follow-ups; "New chain" wizard.
- **Permissions:** `prayer.view` (scoped to chains).
- **Empty:** "No prayer chains yet. Create one to start scheduling."

#### A17 · Prayer: chain board
- **Purpose:** The live day timeline.
- **Components:** Date navigator; vertical timeline of slots (time, assigned people with status chips, completed-late flag, report icon); **Now** marker; uncovered slots highlighted as gaps with "Assign"; right panel: follow-up queue for the chain; filters.
- **Actions:** Assign, substitute, resolve follow-up (Completed verified / Missed / Excused), share link, view report.
- **Filters:** Status, person.
- **Permissions:** `prayer.view` chain scope; actions `prayer.assign` / `prayer.resolve`.
- **Loading:** Timeline skeleton.

#### A18 · Prayer: schedule & commitments
- **Purpose:** Define slot patterns and standing commitments.
- **Components:** Schedule editor (recurrence builder in plain language: "Every day, 24 slots of 60 minutes starting 12:00 AM"); preview of generated slots; commitments table (person, pattern "Tuesdays 2–3 AM", from/to) with conflict warnings; "Generate now".
- **Permissions:** `prayer.manage` / `prayer.assign`.

#### A19 · Devotional: calendar
- **Purpose:** See who serves when.
- **Components:** Week view (default) and month view; each gathering shows team, confirmation counts (5 ✓ · 1 ◷ · 0 ✗) and unfilled required roles.
- **Filters:** Gathering type, team, "needs attention only".
- **Permissions:** `devotional.view`.
- **Empty:** "No devotionals scheduled. Set up a schedule to generate them."

#### A20 · Devotional: roster (`/devotional/{id}`)
- **Purpose:** Build and confirm one gathering's team.
- **Components:** Header (date, time, team, status); roster by role (required/filled, person, status, response note); per-slot actions (assign, substitute with **suggested substitutes**, remind, share link); notes; **Publish roster** (sends links); cancel gathering.
- **Permissions:** `devotional.manage` for actions.
- **Error:** Warnings inline (overlap, unavailable, not a team member).

#### A21 · Devotional: teams & roles / schedules
- **Purpose:** Configure teams (members and default roles), the serving-role vocabulary, and rotations.
- **Components:** Teams list and detail (members, roles matrix); serving roles list (reorder, activate); schedule editor (recurrence, time, rotation teams A → B → C, anchor date) with a 6-occurrence preview.
- **Permissions:** `devotional.teams.manage` / `devotional.manage`.

#### A22 · Ministries
- **Purpose:** Manage ministry service structure (separate from leadership).
- **Components:** List (name, heads, departments, members); detail with departments, teams and members (position, primary).
- **Permissions:** `ministries.view`; manage by global or ministry scope.

#### A23 · Reports
- **Purpose:** Answer recurring questions without spreadsheets.
- **Components:** Catalog grouped by module (only reports the user can run); report page: parameter bar (date range, leader/branch, ministry, team, chain), results table with totals, small chart where helpful, **Export CSV**.
- **Permissions:** `reports.view` + module status permission; export `reports.export`. Rows are always auto-scoped.
- **Empty:** "No data for this period."
- **Loading:** Table skeleton; exports stream with a progress toast.

#### A24 · Notifications
- **Purpose:** Personal inbox; admin template management.
- **Components:** Inbox list (unread first); *Templates* tab (admins): per key/channel/locale editor with variable chips and preview; *Delivery log* (V1).
- **Permissions:** Self; `notifications.manage` for templates.

#### A25 · Users & permissions
- **Purpose:** Control who can see and do what.
- **Components:** Users table (person, email, roles with scopes, 2FA, last login, status); user detail: role assignments (role, scope, depth, expiry, granted by), sessions, invite/deactivate; Roles tab: role → permission checklist grouped by module with sensitive and pastoral markers (custom roles V1); "Effective access" preview ("Mark can see journal status for 12 people and content for 12 people").
- **Permissions:** `iam.users.view` / `iam.users.manage` / `iam.roles.manage`; 2FA required.
- **Error:** Granting blocked with a clear reason.

#### A26 · Settings
- **Purpose:** Ministry-level configuration without code.
- **Components:** Sections listed in §3; each shows the current value, explanation and consequences (e.g. "Increasing content visibility depth lets Primary Leaders read journals of everyone in their branch"), save with confirmation for sensitive settings.
- **Permissions:** `settings.view` / `settings.manage` (+2FA).

#### A27 · QR codes
- **Purpose:** Produce and manage entry codes.
- **Components:** Tabs *General · Leaders · Prayer chains*; table (label, code, status, scans, last scanned); actions: download SVG/PNG, print layouts (wallet card, table tent, poster; GenTouch logo **beside** the code, the leader's name, and a one-line instruction such as "Scan to send your daily journal"), **rotate**; bulk "Generate leader QR cards" (PDF V1).
- **Permissions:** `links.manage`; leaders can download and rotate **their own** code from *My account*.

#### A28 · Audit log
- **Purpose:** Accountability for administrative actions and sensitive reads.
- **Components:** Keyset-paginated table (time, actor, action, entity, summary); filters (actor, action, entity, category, date); detail drawer with old/new values (redacted).
- **Permissions:** `audit.view`; entity history tabs use `audit.view.entity`.

#### A29 · System health
- **Purpose:** Operational confidence.
- **Components:** Last run of each cron job (ok/failed), queue depth, failed jobs with retry, notification provider status, database size.
- **Permissions:** `settings.manage`.

#### A30 · My account
- **Components:** Profile (linked person), sessions (revoke), 2FA, notification preferences, *my leader QR* (download/rotate), personal link to *my* journal.
