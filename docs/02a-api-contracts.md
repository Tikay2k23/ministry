# Phase 2a — Service & API Contracts

> Part of the **Ministry System — Product & Architecture Blueprint**. Table names refer to [03-database.md](03-database.md); permission keys refer to [06-permission-matrix.md](06-permission-matrix.md).

---

## 1. Conventions

### Transport
| Use | Mechanism |
|---|---|
| Portal and public **reads** | React Server Components calling module query functions (no public HTTP endpoint) |
| Portal and public **mutations** | **Server actions** (POST, Origin-checked, progressive enhancement) |
| Cases that need plain HTTP | Route handlers: `/api/auth/*` (Better Auth), `GET /api/public/leaders` (debounced typeahead), `GET /api/qr/{id}` (images), `GET /api/export/{report}` (streamed CSV), `POST /api/webhooks/{provider}`, `GET /api/health` |
| Future mobile app | `/api/v1/*` REST over the **same services** (V2) |

Every operation below is a **service function** `(ctx: RequestContext, input) => Result`. The server action or route handler is a thin adapter: parse input with Zod → call the service → map the result.

### Result envelope
```ts
type Result<T> =
  | { ok: true;  data: T; warnings?: Warning[] }
  | { ok: false; error: { code: ErrorCode; message: string; fieldErrors?: Record<string, string[]>; meta?: object } };
```

### Error codes
| Code | HTTP (route handlers) | Meaning |
|---|---|---|
| `VALIDATION_ERROR` | 422 | Input failed schema/business validation (`fieldErrors` present) |
| `UNAUTHENTICATED` | 401 | No valid session (portal) |
| `NOT_IDENTIFIED` | 401 | Public action requires participant identity |
| `FORBIDDEN` | 403 | Authenticated, in scope, but lacks the permission for *this action* (used only when the record's existence is already known to the actor) |
| `NOT_FOUND` | 404 | Does not exist **or is outside the actor's scope** (BR-A-03) |
| `CONFLICT` | 409 | Uniqueness / stale write (`expectedUpdatedAt` mismatch) / duplicate |
| `INVALID_STATE` | 409 | State-machine transition not allowed (e.g. completing a cancelled slot) |
| `GONE` | 410 | Token expired, revoked, or entry code retired |
| `RATE_LIMITED` | 429 | Includes `meta.retryAfterSeconds` |
| `CHALLENGE_REQUIRED` | 428 | Turnstile token required; the client renders the widget and resubmits |
| `STEP_UP_REQUIRED` | 401 | Re-authentication needed for a sensitive action (V1) |
| `INTERNAL` | 500 | Unexpected; message is generic; details only in logs/Sentry with the request id |

### Pagination
- **Offset** for bounded portal tables: `{ page (1-based), pageSize (10–100, default 25), sort, dir }` → `{ items, total, page, pageSize }`.
- **Keyset** for unbounded streams: `{ cursor?, limit (≤ 100) }` → `{ items, nextCursor | null }`. The cursor is an opaque, signed base64 of the last sort key + id.

### Concurrency & idempotency
- Edits carry `expectedUpdatedAt`. A mismatch returns `CONFLICT` with current data.
- Public submissions carry `idempotencyKey` (UUID). A replay returns the original success payload.
- Hierarchy mutations run under a transaction-scoped advisory lock (see Phase 3 §3).

### Audit
Every mutation writes an `audit_logs` row in the same transaction. Operations marked 🔍 also write an **access** record when they *read* sensitive data.

---

## 2. Public (participant) operations

| Operation | Transport | Authorisation | Input (Zod) | Output | Errors |
|---|---|---|---|---|---|
| `public.resolveEntry` | RSC loader for `/j/{code}`, `/pray/{code}` | none | `code`: 8-char Crockford base32 (normalised: uppercase, O→0, I/L→1) | `{ kind, leader?: { ref, displayName }, chain?: { name, timezone }, status }` | `NOT_FOUND`, `GONE` (retired, with "ask your leader" copy) |
| `public.getParticipant` | RSC loader | device-key cookie (optional) | — | `{ identified: false }` or `{ identified: true, firstName, leader?: { ref, displayName }, journal: { today: SubmissionStatus, canChooseYesterday, received?: { journalDate, at } } }` | — |
| `public.identify` | server action | form session token | `{ phone: string (E.164-normalisable), firstName: 1–80, rememberDevice: boolean }` | `{ result: 'identified' }` or `{ result: 'not_confirmed' }` or `{ result: 'use_personal_link' }` | `RATE_LIMITED`, `VALIDATION_ERROR` |
| `public.register` | server action | form session token; Turnstile when risk-flagged | `{ firstName, lastName, preferredName?, phone?, email?, leaderRef (entry code), ministryId? (if required), birthYear? (if minor check on), consentVersion, guardian?: { name, relationship, consent: true }, rememberDevice }` | `{ firstName, status: 'unconfirmed' }` | `VALIDATION_ERROR`, `RATE_LIMITED`, `CHALLENGE_REQUIRED`, `CONFLICT` (exact phone + full-name match → "use *I've journaled before*") |
| `public.searchLeaders` | `GET /api/public/leaders?q=&fs=` | form session token | `q`: 2–40 chars | `[{ ref, displayName, hint }]`, max 8 (`hint` = ministry or primary leader's first name, for disambiguation) | `RATE_LIMITED`, `VALIDATION_ERROR` |
| `journal.getPublicForm` | RSC loader | identified participant | — | `{ formVersionId, fields: [{ key, type, label, help, required, config }], dateOptions: ['today'] or ['yesterday','today'] }` | `NOT_IDENTIFIED` |
| `journal.submit` | server action | identified participant | `{ idempotencyKey: uuid, formVersionId: uuid, journalDateChoice: 'today' \| 'yesterday', answers: Record<fieldKey, AnswerValue>, leaderRef?: string }` | `{ receiptCode, journalDate, receivedAt, timing: 'on_time' \| 'late', leaderChangeRequested: boolean }` | `NOT_IDENTIFIED`, `VALIDATION_ERROR` (per field), `CONFLICT` (`ALREADY_SUBMITTED`, meta `{ receivedAt, canEdit }`), `INVALID_STATE` (`DAY_CLOSED`, `FORM_VERSION_RETIRED` → reload), `RATE_LIMITED` |
| `journal.editOwn` | server action | device key of the submitter only | `{ idempotencyKey, journalDate, answers }` | same as submit, `revisionNo` | `INVALID_STATE` (`EDIT_WINDOW_CLOSED`), `NOT_FOUND` |
| `links.installPersonalKey` | `GET /k/{token}` → page with button → server action | token | `{ token }` | sets device cookie; redirects to `/j` (clean URL) | `GONE`, `NOT_FOUND` |
| `prayer.getChainPage` | RSC loader `/pray/{code}` | none / device key | — | `{ chain, now: { slot, prayingFirstNames? }, mySlots?: [...], coverageToday: { covered, total } }` | `NOT_FOUND`, `GONE` |
| `prayer.respond` | server action `/a/{token}` or chain page | action token **or** device key matching `assignment.person_id` | `{ assignmentRef, action: 'confirm' \| 'check_in' \| 'complete' \| 'cannot_make_it', note?: ≤500, report?: answers }` | `{ assignment: { status, completedLate }, next?: { slotStartsAt } }` | `INVALID_STATE` (e.g. complete on cancelled), `VALIDATION_ERROR` (`WINDOW_NOT_OPEN`), `GONE`, `NOT_FOUND` |
| `devotional.respond` | server action `/a/{token}` | action token | `{ response: 'accept' \| 'decline', note?: ≤500 }` | `{ status, gathering: { date, role, team } }` | `GONE`, `INVALID_STATE` (cancelled/replaced), `VALIDATION_ERROR` (change after lock time) |

**Validation notes (public):** strings are trimmed and NFC-normalised; control characters stripped; `phone` is parsed with libphonenumber (default region PH) and rejected if invalid; answer values are validated against the field definition (type, required, options, length ≤ 10 KB); unknown field keys are rejected; `leaderRef` must be an active journal-leader entry code whose leader `accepts_members`.

**Implementation note (M2, 2026-09-15).** The journal operations are JSON route handlers:
- Every response is `{ data }` or `{ error: { code, message, fieldErrors?, meta? } }`, sent with `Cache-Control: no-store`.
- Mutations require a same-origin `Origin` header.
- The device key travels only in the HttpOnly cookie.

| Route | Operation |
|---|---|
| `GET /api/public/journal?code=&scan=1` | `public.resolveEntry`, `public.getParticipant` and `journal.getPublicForm` in one call. Returns `{ formSession, code?: { found, active, kind, leader? }, participant?: { firstName, leaderName, rememberedDevice, timezone, form, dates: [{ date, label, received? }] }, leaderMismatch }` |
| `POST /api/public/identify` | `public.identify` |
| `POST /api/public/register` | `public.register`; returns `{ firstName, leaderName }` |
| `GET /api/public/leaders?q=` | `public.searchLeaders`; rate-limited per IP, no form session needed |
| `POST /api/public/journal` | `journal.submit`. Takes `journalDate` (YYYY-MM-DD: today, or yesterday before the late cutoff) plus optional `entryCode` and `requestLeaderChange`. The receipt is `{ journalDate, receivedAt, timing, revisionNo, leaderName, leaderChangeRequested }`, with no receipt code |
| `PUT /api/public/journal` | `journal.editOwn`; remembered device only, before the deadline |
| `GET /api/public/journal/entry?date=` | The person's own answers, to prefill an edit; remembered device only, within the edit window |
| `POST /api/public/personal-link` | `links.installPersonalKey`; the `/k/{token}` page posts here |
| `POST /api/public/forget` | "Use as someone else": revokes this device's key and clears the cookie |

---

## 3. Portal operations

### 3.1 Authentication & IAM
| Operation | Authorisation | Input | Output | Errors |
|---|---|---|---|---|
| `auth.requestMagicLink` (Better Auth) | public | `{ email }` | always `{ sent: true }` (no enumeration) | `RATE_LIMITED` |
| `auth.verifyMagicLink` | token | query `token` | session cookie → redirect (→ 2FA challenge if enabled) | `GONE` |
| `auth.verifyTotp` | pending 2FA session | `{ code: 6 digits }` | full session | `VALIDATION_ERROR`, `RATE_LIMITED` |
| `auth.listSessions` / `auth.revokeSession` | self | `{ sessionId }` | sessions (device, IP city, last active) | `NOT_FOUND` |
| `iam.inviteUser` | `iam.users.manage` | `{ personId, email, assignments: RoleAssignmentInput[] }` | `{ userId }` | `CONFLICT` (email used / person already linked), `FORBIDDEN` (granting a permission or scope you don't hold) |
| `iam.assignRole` / `iam.revokeRole` | `iam.users.manage` + holds every permission in the role, within scope | `{ userId, roleKey, scopeType, scopeId?, branchMaxDepth?, expiresAt? }` | assignment | `FORBIDDEN`, `CONFLICT`, `VALIDATION_ERROR` (scope type not allowed for role) |
| `iam.deactivateUser` | `iam.users.manage` | `{ userId, reason }` | — (sessions revoked) | `NOT_FOUND`, `INVALID_STATE` (last Super Admin) |
| `iam.listUsers` / `iam.getUser` | `iam.users.view` | filters, pagination | users with roles & scopes | — |

### 3.2 People
| Operation | Authorisation (scope) | Input | Output | Errors |
|---|---|---|---|---|
| `people.search` | `people.view` (scoped) | `{ q?, leaderId?, primaryLeaderId?, ministryId?, departmentId?, teamId?, levelDepth?, status?, designation?, registration?, archived?: false, sort: 'name' \| 'joined' \| 'updated', page, pageSize }` | `{ items: PersonListItem[], total }` (contact fields only with `people.contact.view`) | `VALIDATION_ERROR` |
| `people.get` | `people.view` | `{ personId }` | `PersonDetail` (sections filtered by permission) | `NOT_FOUND` |
| `people.create` | `people.create` (placement must be within scope) | `PersonInput & { leaderId?, ministryMemberships?, confirmNotDuplicate?: boolean }` | `{ personId }` | `CONFLICT` (`DUPLICATE_SUSPECTED`, meta: candidates) until `confirmNotDuplicate` |
| `people.update` | `people.edit` (+ `people.contact.edit` for contact fields) | `{ personId, patch, expectedUpdatedAt }` | updated person | `CONFLICT`, `VALIDATION_ERROR`, `NOT_FOUND` |
| `people.archive` | `people.archive` | `{ personId, reason, note? }` | — | `INVALID_STATE` (`HAS_DIRECT_GROUP`) |
| `people.confirmRegistration` | `people.registrations.confirm` (direct group) | `{ personId, decision: 'confirm' \| 'not_mine', suggestedLeaderId? }` | — | `INVALID_STATE` (already confirmed) |
| `people.issuePersonalLink` | `people.links.issue` (scoped) | `{ personId }` | `{ url, expiresAt }` (shown once; audited) | `NOT_FOUND` |
| `people.revokeDeviceKeys` | `people.links.issue` | `{ personId, keyId? }` | count revoked | — |
| `people.duplicates.list` / `.resolve` | `people.merge` | `{ candidateId, decision: 'merge' \| 'not_duplicate', survivorId? }` | — | `CONFLICT` |
| `people.export` | `people.export` | same filters as search | CSV stream (audited) | — |
| `import.people.upload` | `import.manage` | CSV ≤ 5 MB, ≤ 20k rows, UTF-8 | `{ importJobId }` → background validation | `VALIDATION_ERROR` (bad header/encoding) |
| `import.people.preview` | `import.manage` | `{ importJobId, page }` | row outcomes + messages + summary | — |
| `import.people.commit` | `import.manage` | `{ importJobId, skipRowsWithWarnings: boolean }` | job → stats | `INVALID_STATE` |

### 3.3 Leadership hierarchy
| Operation | Authorisation | Input | Output | Errors |
|---|---|---|---|---|
| `hierarchy.children` | `hierarchy.view` (scoped) | `{ parentId \| 'roots' }` | `[{ personId, name, depth, levelName, directCount, branchSize, acceptsMembers }]` | `NOT_FOUND` |
| `hierarchy.ancestors` | `people.view` | `{ personId }` | ordered chain of leadership | `NOT_FOUND` |
| `hierarchy.place` | `hierarchy.manage` (new leader in scope) | `{ personId, leaderId, reason? }` | node | `CONFLICT` (`ALREADY_PLACED`), `NOT_FOUND` |
| `hierarchy.move` | `hierarchy.manage` (source **and** target in scope) | `{ personId, newLeaderId, mode: 'with_subtree' \| 'leave_group', groupNewLeaderId? (required for leave_group), reason, expectedLeaderId }` | `{ operationId, movedCount }` | `VALIDATION_ERROR` (`CYCLE`), `CONFLICT` (stale `expectedLeaderId`), `NOT_FOUND` |
| `hierarchy.reassignGroup` | `hierarchy.manage` | `{ fromLeaderId, assignments: [{ personId, newLeaderId }] }` or `{ fromLeaderId, allTo }` | `{ operationId }` | `VALIDATION_ERROR` |
| `hierarchy.remove` | `hierarchy.manage` | `{ personId, reason }` | — | `INVALID_STATE` (`HAS_DIRECT_GROUP`) |
| `hierarchy.setAcceptsMembers` | `hierarchy.manage` | `{ personId, value }` | — | — |
| `leaderChange.list` | `hierarchy.requests.decide` (scoped) or receiving leader | `{ status?, page }` | requests | — |
| `leaderChange.decide` | receiving leader, or `hierarchy.requests.decide` covering both leaders | `{ requestId, decision: 'approve' \| 'reject', note? }` | — (approve → `hierarchy.move`) | `INVALID_STATE`, `NOT_FOUND` |
| `hierarchy.levels.update` | `settings.manage` | `[{ depth, name, pluralName }]`, `primaryDepth` | levels | `VALIDATION_ERROR` |

### 3.4 Daily journal
| Operation | Authorisation | Input | Output | Errors |
|---|---|---|---|---|
| `journal.today` | `journal.status.view` (scoped) | `{ view: 'direct' \| 'branch' \| 'ministry_all', anchorId?, date?, filter?: SubmissionStatus[], page }` | `{ summary: { expected, received, onTime, late, notYet, missed, excused, reviewed, awaitingReview, followUps, pct }, rows: [{ personId, name, submission, review, care, receivedAt, streakMissed }] }` | `NOT_FOUND` (anchor out of scope) |
| `journal.branchSummary` | `journal.status.view` | `{ anchorId, date \| range }` | `{ totals, children: [{ leaderId, name, groupSize, received, pct, trend7 }] }` | `NOT_FOUND` |
| `journal.getEntry` 🔍 | `journal.content.view` + sensitivity rules + policy depth | `{ personId, journalDate }` | `{ meta, answers: VisibleAnswer[], hiddenAnswers: { count, reason }, revisions: number, reviews: [...] }` | `NOT_FOUND` |
| `journal.reviewQueue` | `journal.review` | `{ cursor?, limit }` | next awaiting-review entries in scope (oldest first) | — |
| `journal.review` | `journal.review` (scope + content-visible) | `{ personId, journalDate, comment?: ≤2000, flagFollowUp?: boolean, shareWithPerson?: boolean (V1) }` | review | `NOT_FOUND`, `INVALID_STATE` (no entry) |
| `journal.proxySubmit` | `journal.proxy_submit` (direct group) | `{ personId, journalDate (≤ 7 days back), answers, note }` | entry | `CONFLICT`, `VALIDATION_ERROR` |
| `journal.excuse` | `journal.excuse` (scoped) | `{ personId, dates: date[] ≤ 31, reason }` | updated days | `VALIDATION_ERROR` |
| `journal.pauses.create` / `.cancel` | `journal.excuse` | `{ personId, from, to?, reason, note? }` | pause | `CONFLICT` (overlap) |
| `journal.personHistory` | `journal.status.view` | `{ personId, from, to }` | days + `{ rate7, rate30, rateMonth, currentMissedStreak }` | `NOT_FOUND` |
| `journal.calendar.upsert` | `journal.settings.manage` | `{ day, kind, excusesJournal, note }` | — (queues `journal.resync_day` for that date if open) | `VALIDATION_ERROR` |
| `forms.getEditor` | `forms.manage` | `{ formKey }` | published version + draft (auto-created by copy) | — |
| `forms.saveDraft` | `forms.manage` | `{ formKey, fields: FieldInput[], expectedDraftId }` | draft | `VALIDATION_ERROR` (duplicate keys, invalid options, >40 fields), `CONFLICT` |
| `forms.publish` | `forms.publish` | `{ formKey, draftId }` | new version number | `INVALID_STATE` (empty form / no changes) |

### 3.5 Follow-ups (care)
| Operation | Authorisation | Input | Output | Errors |
|---|---|---|---|---|
| `care.list` | `care.view` (scoped; pastoral-visibility items need `care.pastoral.view`) | `{ kind?, status?, assignedToMe?, page }` | items (summary only) | — |
| `care.create` | `care.manage` | `{ personId, kind: 'general', summary, visibility, dueOn? }` | item | `NOT_FOUND` |
| `care.update` | `care.manage` | `{ id, status, resolutionNote?, assignedToPersonId? }` | item | `INVALID_STATE` |

### 3.6 Prayer chain
| Operation | Authorisation | Input | Output | Errors |
|---|---|---|---|---|
| `prayer.chains.list` / `.get` | `prayer.view` | filters | chains with today's coverage | — |
| `prayer.chains.create` / `.update` / `.setStatus` | `prayer.manage` (chain scope for update) | `ChainInput` (name, type, timezone IANA, starts/ends, grace 0–240, check-in window, report form) | chain | `VALIDATION_ERROR` |
| `prayer.schedules.upsert` | `prayer.manage` | `{ chainId, rrule (validated, ≤ daily granularity), firstSlotTime, slotMinutes, slotsPerOccurrence, capacity, effectiveFrom, effectiveTo? }` | schedule + preview of next 3 occurrences | `VALIDATION_ERROR` (overlapping slots generated) |
| `prayer.slots.generate` | `prayer.manage` | `{ chainId, from, to (≤ 60 days) }` | `{ created, existing, assignmentsCreated }` | — |
| `prayer.commitments.create` / `.end` | `prayer.assign` | `{ chainId, personId, rrule, localStartTime, effectiveFrom, effectiveTo? }` | commitment + conflicts preview | `CONFLICT` (overlaps an existing commitment) |
| `prayer.board` | `prayer.view` (chain scope) | `{ chainId, date }` | `{ slots: [{ id, startsAt, endsAt, capacity, assignments: [{ id, person, status, times, completedLate }] }], summary }` | `NOT_FOUND` |
| `prayer.assign` | `prayer.assign` | `{ slotId, personId, note? }` | assignment | `CONFLICT` (`OVERLAP`, `CAPACITY_FULL`, `ALREADY_ASSIGNED`), `INVALID_STATE` (slot cancelled/past) |
| `prayer.substitute` | `prayer.assign` | `{ assignmentId, substitutePersonId, reason? }` | `{ original: 'replaced', substitute }` (original's tokens revoked) | `INVALID_STATE`, `CONFLICT` (`OVERLAP`) |
| `prayer.resolve` | `prayer.resolve` | `{ assignmentId, outcome: 'completed_verified' \| 'missed' \| 'excused', note? }` | assignment | `INVALID_STATE` (only from `needs_follow_up` or `completed` late) |
| `prayer.getReport` 🔍 | `prayer.reports.view` (+ pastoral for requests marked confidential) | `{ assignmentId }` | report answers (anonymity respected) | `NOT_FOUND` |
| `prayer.shareLink` | `prayer.assign` | `{ assignmentId }` | `{ url, expiresAt }` (new token; previous revoked) | `INVALID_STATE` |

**Implementation note (M3, 2026-09-16).** How the prayer chain operations were built, and where they differ from the table above:
- **Portal:** pages call the services in `src/server/modules/prayer/` through server actions (`src/app/app/prayer/actions.ts`). The services check permission and chain scope on every call. `GET /api/prayer/people?chainId=&q=` finds people to put on a slot.
- **Public:** JSON route handlers, like the journal: the same response shape, same-origin mutations, and the device key in the HttpOnly cookie.

| Route | Operation |
|---|---|
| `GET /api/public/prayer/chain?code=&scan=1` | `prayer.getChainPage`. Returns `{ formSession, status, chain: { name, description, state, timezone }, now: { slotLabel, prayingCount, prayingFirstNames }, coverageToday: { covered, total }, participant: { firstName, slots } }`. First names appear only when the chain allows it |
| `POST /api/public/prayer/respond` | `prayer.respond`, with `{ token }` from `/a/{token}`, or `{ assignmentId }` plus the device key. The report is sent separately |
| `POST /api/public/prayer/report` | The optional report: `{ token \| assignmentId, answers, anonymous, formSession }`, once per assignment (`CONFLICT`, reason `ALREADY_SUBMITTED`) |

- **`prayer.slots.generate`** has no endpoint and no "Generate now" button. Slots are generated when a chain starts, when a schedule or commitment is added, and hourly by the `prayer.generate_slots` job, each schedule `generateDaysAhead` days ahead.
- **`prayer.schedules.upsert`** is *add* and *end*:
  - A schedule is never edited in place, so slots already generated stay consistent. Ending one cancels its upcoming slots.
  - The browser previews the next 3 occurrences with the same functions the service uses.
- **`prayer.shareLink`** doesn't revoke earlier links:
  - A reminder email and a link the coordinator shared can both be in use. All of an assignment's links are revoked when it is replaced or cancelled.
  - A link is valid until 7 days after the slot ends (not `ends_at + grace + 24 h`), so a late "I've finished" and the report still work.
- **`prayer.assign`** searches confirmed people by name or person code, with those who already pray in the chain first. Unavailability warnings aren't shown yet.
- **`prayer.board`** also returns the follow-up queue, the "needs a substitute" list and what the viewer may do (`can`). The status and person filters aren't built yet.
- **Completion report (FR-RPT-02):** `/app/reports/prayer` and `GET /api/reports/prayer.csv?tab=days|people&chainId=&from=&to=` (audited as `report.exported`), scoped by `prayer.view` on the chain.
- **Inbox (A24):** `/app/notifications`, unread first, with the unread count in the navigation. The template editor and delivery log come later.

### 3.7 Devotional / worship
| Operation | Authorisation | Input | Output | Errors |
|---|---|---|---|---|
| `devotional.calendar` | `devotional.view` | `{ from, to (≤ 62 days), gatheringTypeId? }` | gatherings with team + confirmation counts | — |
| `devotional.gathering.get` | `devotional.view` | `{ gatheringId }` | roster by role (required vs filled), statuses, notes | `NOT_FOUND` |
| `devotional.gathering.create` / `.update` / `.cancel` | `devotional.manage` (gathering-type scope) | one-off or edits (team, time, notes), cancel with reason | gathering | `INVALID_STATE` (past / cancelled) |
| `devotional.gathering.rebuildRoster` | `devotional.manage` | `{ gatheringId }` (only if roster not published) | roster | `INVALID_STATE` |
| `devotional.gathering.publishRoster` | `devotional.manage` | `{ gatheringId }` | — (creates action tokens + notifications) | `VALIDATION_ERROR` (required roles unfilled → warning; `force` to publish anyway) |
| `devotional.assign` | `devotional.manage` | `{ gatheringId, servingRoleId, personId }` | assignment + `warnings` (`OVERLAP`, `NOT_TEAM_MEMBER`, `UNAVAILABLE`) | `CONFLICT` (duplicate) |
| `devotional.suggestSubstitutes` | `devotional.manage` | `{ assignmentId }` | ranked candidates `{ person, reasons: ['same role','available','served 3 weeks ago'] }` | — |
| `devotional.substitute` | `devotional.manage` | `{ assignmentId, personId }` | new assignment | `CONFLICT`, `INVALID_STATE` |
| `devotional.schedules.upsert` | `devotional.manage` | `{ gatheringTypeId, name, rrule, startTime, durationMinutes, effectiveFrom, rotationMode, rotationTeamIds[], rotationAnchor, generateDaysAhead }` | schedule + preview of next 6 occurrences with teams | `VALIDATION_ERROR` |
| `devotional.teams.*` / `servingRoles.*` | `devotional.teams.manage` | team CRUD, member add/remove, member roles | — | `CONFLICT` |
| `devotional.unavailability.set` | `devotional.manage` or self (V1 via link) | `{ personId, from, to, reason? }` | — | `VALIDATION_ERROR` |
| `devotional.shareLink` | `devotional.manage` | `{ assignmentId }` | `{ url }` | — |

**Implementation note (M4, 2026-09-17).** How the devotional operations were built, and where they differ from the table above:
- **Portal:** pages call the services in `src/server/modules/devotional/` through server actions (`src/app/app/devotional/actions.ts`). The services check the permission and the gathering type's scope on every call.

| Page | Operations |
|---|---|
| `/app/devotional` | `devotional.calendar` for one week, Monday to Sunday (`?week=&type=&attention=1`), rather than a `from`/`to` range. "Publish this week" publishes the drafts the viewer may publish |
| `/app/devotional/{gatheringId}` | `devotional.gathering.get`, with assign, find a substitute, remove, share their link, publish, "Fill again from the team" (`rebuildRoster`), cancel, and title and notes |
| `/app/devotional/teams` | `devotional.teams.*`: worship teams, their members, the roles each member plays (one main role) and away dates |
| `/app/devotional/setup` | Kinds of gatherings (`gatheringTypes.create`) and `servingRoles.*` |
| `/app/devotional/setup/{typeId}` | `devotional.schedules.*`, the roster template, one-off gatherings, the gathering's details and its Worship Coordinators |

- **Typeahead:** `GET /api/devotional/people?gatheringId=&servingRoleId=&q=` puts people who play the role, and the gathering's team, first. `?teamId=&q=` finds people to add to a team. Both return names and person codes only.
- **Public:** `POST /api/public/serving/respond` with `{ token, response: 'accept' | 'decline', note? }` returns `{ view }`. `/a/{token}` serves prayer and serving links alike, by the token's purpose.
  - Errors: `GONE` (reason `CANCELLED` or `REASSIGNED`) and `INVALID_STATE` (`STARTED`, or `LOCKED`).
  - `LOCKED`: someone who has already replied can't change their reply within `response_lock_hours` of the start. A first reply is accepted until the gathering starts.
  - A decline opens a care follow-up and sends the coordinators an in-app notice.
- **`devotional.gathering.publishRoster`** takes `{ gatheringIds[], force }`.
  - Rosters with required roles still open don't cause a `VALIDATION_ERROR`. They come back in `needsForce` with their open roles, and the page asks whether to publish anyway.
  - Only people who haven't been told yet get an email, with their personal link.
- **`devotional.gathering.update`** edits the title and notes. Moving a gathering or changing its team isn't built: cancel it and create a one-off instead. A one-off gathering is filled from the team chosen for it.
- **`devotional.schedules.upsert`** is *add* and *end*, as for prayer:
  - Gatherings are created when the schedule is added, then hourly by the `devotional.generate_gatherings` job.
  - Ending a schedule cancels its upcoming gatherings and tells the people who had confirmed.
  - The browser previews the next 6 occurrences and their teams with the functions the generator uses.
  - Schedules repeat daily, on chosen weekdays, or monthly (a day of the month, or the first to fourth or last weekday). Monthly schedules rotate per occurrence, not per week.
- **`devotional.assign`** warnings are `UNAVAILABLE`, `OVERLAP` and `NOT_TEAM_MEMBER`. None of them blocks the assignment.
- **`devotional.shareLink`** doesn't revoke earlier links. A link stops working when the gathering ends, and all of an assignment's links are revoked when the person is replaced or removed or the gathering is cancelled.
- **`devotional.unavailability.set`** is add and remove, by anyone with `devotional.manage` or `devotional.teams.manage`, for people within their `people.view` scope. It lists the gatherings the person is already rostered for on those days. Self-service is still V1.
- **Worship Coordinators** are appointed on the gathering's setup page by someone with global `iam.users.manage`, not on the Users page, because the role's scope is the gathering type.
- **Dashboard (FR-DEV-09):** a Devotional card with the next three days' gatherings and their replies (5 ✓ · 1 ◷ · 0 ✗). "Needs your attention" adds required roles still open within two days, and people who can't serve.
- **Not built yet:** reordering serving roles, a devotional report, and the notification template editor and delivery log.

### 3.8 Ministries
| Operation | Authorisation | Input | Output |
|---|---|---|---|
| `ministries.list` / `.get` | `ministries.view` | — | ministries, departments, teams, member counts |
| `ministries.create` / `.update` / `.archive` | `ministries.manage` (global) | name, code, description | — |
| `departments.*`, `teams.*` | `ministries.manage` or `ministry.structure.manage` (ministry scope) | — | — |
| `memberships.add` / `.end` / `.update` | `ministry.members.manage` (ministry scope) | `{ personId, ministryId, departmentId?, position, isPrimary }` | — |

### 3.9 Reports
| Operation | Authorisation | Input | Output | Errors |
|---|---|---|---|---|
| `reports.catalog` | any portal user | — | reports available to the actor | — |
| `reports.run` | `reports.view` + the source module's status permission; rows auto-scoped | `{ reportKey, params: { from, to (≤ 366 days), anchorId?, ministryId?, teamId?, chainId?, status? }, page }` | `{ columns, rows, totals, generatedAt }` | `VALIDATION_ERROR`, `NOT_FOUND` |
| `reports.exportCsv` | `reports.export` (+ `people.contact.view` to include contact columns) | same params, `GET /api/export/{reportKey}` | streamed CSV (UTF-8 BOM for Excel), audited | `RATE_LIMITED` (5 exports / 10 min) |

**Journal content is never part of a report or export in the MVP.** Content export would be a V1 pastoral-only feature with step-up authentication.

### 3.10 Notifications
| Operation | Authorisation | Input | Output |
|---|---|---|---|
| `notifications.inbox` | self | `{ cursor?, unreadOnly? }` | items |
| `notifications.markRead` | self | `{ ids[] \| 'all' }` | — |
| `notifications.templates.list` / `.update` | `notifications.manage` | `{ key, channel, locale, subject?, body }` (placeholders validated against the template's variable schema) | new version |
| `notifications.deliveries.list` (V1) | `notifications.manage` | filters | delivery log (masked destinations) |
| `webhooks.{provider}` | provider signature | provider payload | 200 after verification; status updates |

### 3.11 Settings & audit
| Operation | Authorisation | Input | Output |
|---|---|---|---|
| `settings.get` | `settings.view` | `{ key }` | value |
| `settings.update` | `settings.manage` (+ 2FA; step-up V1) | `{ key, value (Zod per key), expectedUpdatedAt }` | value |
| `links.entryCodes.list` / `.create` / `.rotate` | `links.manage` (or own leader code: `links.own.manage`) | `{ kind, leaderId? / chainId? }` | entry code + QR URL |
| `audit.list` | `audit.view` | `{ entityType?, entityId?, actorUserId?, action?, from, to, cursor }` | keyset page |
| `audit.forEntity` | view permission on the entity + `audit.view.entity` | `{ entityType, entityId, cursor }` | history tab |
| `system.health` | `settings.manage` | — | job queue depth, failed jobs, last cron runs, provider status |

**Implementation note (M5.2, 2026-09-17).** Server actions in `src/app/app/admin/actions.ts`; services in `src/server/modules/settings/`.

| Page | Operations |
|---|---|
| `/app/admin/settings` | `settings.get` / `settings.update` for Daily Journal, Leadership (with level names), General, People fields, Public journal page and Privacy. Open with `settings.view` or a global `journal.settings.manage` |
| `/app/admin/health` | `system.health` and "Run now" |

- **`settings.update`:**
  - **Permissions:** the journal policy needs a global `journal.settings.manage`, so pastors can change it (docs/06 row 20). Every other key needs `settings.manage`.
  - **Journal visibility:** raising `contentVisibilityDepth`, which lets more leaders read journal answers, also needs a two-step-verified session (`FORBIDDEN`). Lowering it doesn't.
  - **Validation and audit:** invalid values return `VALIDATION_ERROR` with per-field messages, and an unknown key returns `NOT_FOUND`. Each change is audited as `settings.updated` with its old and new values.
  - The forms render the saved values on the server, so fields never look empty before the page's scripts load.
- **Leadership level names:** `saveLeadershipLevels({ levels: [{ name, pluralName, description? }] })` replaces the names from the top down (depth 0 first), removes deeper levels, needs `settings.manage`, and is audited.
- **`system.health`:**
  - **Contents:** every job with its label, interval, last and next run, run and failure counts, and last error summary. Also notifications waiting, sent in the last day and failed in the last week, the database size, and which providers are in use (never keys).
  - **Stalled scheduler:** it is reported stalled when no job has started for 15 minutes, with advice for the scheduler mode.
  - **"Run now":** `runJobSoon({ jobKey })` makes the job due at the next tick (within a minute) and is audited as `system.job_run_requested`.
- **`audit.forEntity`:** the person profile's Activity list shows the last 20 entries in plain words: who did it, when, and for profile edits the names of the changed fields. Old and new values never leave the server. Access-log entries are recorded against entries and reports, never people, so they don't appear. The global audit viewer (A28) is still V1.
- **Not built yet:** publishing a new privacy notice from the portal (the approved text replaces the draft in `src/app/(public)/privacy/page.tsx`, and `privacy.noticeVersion` records the version), the retention, prayer-default and notification settings, and QR code management (A27, part 5.4).

---

## 4. Core DTO sketches

```ts
type SubmissionStatus = 'pending' | 'submitted' | 'late' | 'missed' | 'excused'; // UI: 'Not yet' for pending
type ReviewStatus     = 'none' | 'awaiting' | 'reviewed';
type CareStatus       = 'none' | 'needs_follow_up' | 'resolved';

type AnswerValue =
  | { t: 'text'; v: string }                        // short/long text, reflection, gratitude, testimony, prayer_request
  | { t: 'bool'; v: boolean }                       // yes_no
  | { t: 'choice'; v: string }                      // single_choice (option key)
  | { t: 'choices'; v: string[] }                   // multi_choice
  | { t: 'number'; v: number }
  | { t: 'scripture'; v: { book: string; chapter: number; verseStart?: number; verseEnd?: number; raw: string } }
  | { t: 'date' | 'time' | 'datetime'; v: string }; // ISO 8601

interface RequestContext {
  requestId: string;
  now: Date;                       // injectable clock
  actor:
    | { kind: 'user'; userId: string; personId?: string; grants: Grant[]; twoFactorVerified: boolean }
    | { kind: 'participant'; personId: string; via: ParticipantChannel }
    | { kind: 'anonymous' }
    | { kind: 'system'; job: string };
  ip?: string; userAgent?: string;
}

interface Grant {                  // resolved from user_role_assignments at session load (cached per request)
  permission: string;              // 'journal.status.view'
  scope: { type: 'global' } | { type: 'branch'; anchorPersonId: string; maxDepth: number | null }
       | { type: 'ministry' | 'team' | 'prayer_chain' | 'gathering_type'; id: string };
}
```
