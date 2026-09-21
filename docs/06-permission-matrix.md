# Phase 6 — Permission Matrix

> Part of the **Ministry System — Product & Architecture Blueprint**.
> In Phase 8 this matrix becomes **one TypeScript source of truth** (`src/server/policy/catalog.ts`) that seeds the `permissions`/`roles` tables **and** drives the automated permission test suite, so the docs, the database and the tests can't drift apart.

---

## 1. Principles

1. **Deny by default.** Nothing is visible or possible unless a grant allows it.
2. **Permission + scope.** A grant is *"permission P over scope S"*. The same role (Leader) gives different people different data because the scope is anchored on *their* place in the tree.
3. **Status ≠ content.** Knowing *that* someone journaled is a different permission from reading *what* they wrote. Content has three sensitivity tiers.
4. **System administration ≠ pastoral access.** Super Admins configure the system. They do not read journals, confidential answers or pastoral notes unless they deliberately invoke audited **break-glass** access.
5. **Out of scope looks like "doesn't exist"** (404), never "access denied".
6. **Sensitive permissions require 2FA**, and every sensitive read is recorded in the access log.
7. **You can't grant sensitive access you don't hold.** To grant a role, you must hold every *sensitive* (⚠) permission it contains. Low-risk operational permissions don't count. This is how a Pastor can grant Leader, Primary Leader and Pastoral Care roles but not Ministry Administrator (import and merge) or Super Admin. The exception is the Super Admin, whose grants of pastoral permissions are flagged in the audit log and, once notifications arrive (M2), notify all Pastors immediately. *(Refined during M0 implementation: the strict "every permission" version contradicted row 34 of the matrix.)*

### Roles
| Code | Role | Default scope |
|---|---|---|
| **SA** | Super Admin | Global (system configuration) |
| **PX** | Pastor / Executive Leadership | Global |
| **PC** | Pastoral Care *(recommended new role)* | Global (or branch) |
| **MA** | Ministry Administrator (Office) *(recommended new role)* | Global, **no content** |
| **PL** | Primary Leader | Branch anchored on self, unlimited depth |
| **LD** | Leader | Branch anchored on self, depth 1 (see note a) |
| **MH** | Ministry Head | Their ministry |
| **WC** | Worship Coordinator | Worship gathering type(s) / worship teams |
| **PCC** | Prayer Chain Coordinator | Assigned chain(s) |
| **VW** | Viewer | Global or branch, read-only aggregates |
| — | **Participant** (no login) | Self only |

A person can hold several roles (e.g. a Primary Leader who is also Worship Coordinator). Effective access is the **union** of grants.

### Legend
**V** view · **C** create · **E** edit · **D** delete/archive · **A** approve · **R** review · **X** export · **M** manage/configure (includes V C E D)
Scope: **G** global · **B** own branch (self + downline) · **D** own direct group · **M** own ministry · **T** own team(s)/gathering types · **C** assigned chain(s) · **own** own records · — none

---

## 2. The matrix

| # | Resource | SA | PX | PC | MA | PL | LD | MH | WC | PCC | VW |
|---|---|---|---|---|---|---|---|---|---|---|---|
| 1 | People: profile basics | VCED G | VE G | V G | VCED G | VC B · E D | VCE D | V M | V T | V C | V G |
| 2 | People: contact details (phone, email, address, birthday) | VE G | V G | V G | VE G | V B · E D | VE D | V M | V T | V C | — |
| 3 | New registrations (confirm / not mine) | A G | A G | — | A G | A B | A D | — | — | — | — |
| 4 | Duplicates, merge, import | M | — | — | M | — | — | — | — | — | — |
| 5 | Personal links & device keys | M G | — | — | M G | M B | M D | — | — | — | — |
| 6 | People export (CSV) | X G | X G | — | X G | X B | X D | X M | — | — | — |
| 7 | Leadership hierarchy (view) | V G | V G | V G | V G | V B | V D ᵃ | — | — | — | V G |
| 8 | Hierarchy changes (place / move / reassign) | E G | E G | — | E G | E B | — ᵇ | — | — | — | — |
| 9 | Leader change requests | A G | A G | — | A G | A B | A (incoming) | — | — | — | — |
| 10 | Leadership level names & hierarchy settings | M | — | — | — | — | — | — | — | — | — |
| 11 | Ministries, departments, teams | M G | V | V | M G | V | V | M M | M (worship teams) | V | V |
| 12 | **Journal status** (who submitted, late, missed) | V G | VX G | V G | VX G | VX B | VX D ᵃ | — | — | — | V G |
| 13 | **Journal content: standard** answers | — ᶜ | VR G | VR G | — | VR D ᵈ | VR D | — | — | — | — |
| 14 | **Journal content: restricted** answers | — ᶜ | V G | V G | — | V D | V D | — | — | — | — |
| 15 | **Journal content: confidential** answers | — ᶜ | V G | V G | — | — | — | — | — | — | — |
| 15a | **Journal proof photo** (the written journal) | — ᶜ | V G | V G | — | V D | V D | — | — | — | — |
| 15b | Remove a proof photo from a journal | — ᶜ | E G | E G | — | — | — | — | — | — | — |
| 16 | Leader review comments | — | CV G | CV G | — | CV D | CV D | — | — | — | — |
| 17 | Journal excusals & personal pauses | CE G | CE G | CE G | CE G | CE B | CE D | — | — | — | — |
| 18 | Proxy journal submission | — | — | — | — | C D | C D | — | — | — | — |
| 19 | Journal questions (form builder) | E | A (publish) | — | E | — | — | — | — | — | — |
| 20 | Journal policy & rest days | M | M | — | CE (rest days) | — | — | — | — | — | — |
| 21 | Follow-ups: leadership visibility | — | VCE G | VCE G | V G ᵉ | VCE B | VCE D | — | VCE T | VCE C | — |
| 22 | Follow-ups: pastoral visibility | — | VCE G | VCE G | — | — | — | — | — | — | — |
| 23 | Leadership notes (V1) | — | VC G | VC G | — | VC B | VC D | — | — | — | — |
| 24 | **Pastoral notes** (V1) | — | VCE G | VCE G | — | — | — | — | — | — | — |
| 25 | Prayer chains & schedules | M G | V G | V G | V G | — | — | M M ᶠ | — | M C | V G |
| 26 | Prayer assignments & statuses | M G | V G | V G | V G | V B ᵍ | V D ᵍ | V M | — | CEA C | V G |
| 27 | Prayer reports & testimonies | — | V G | V G | — | — | — | — | — | V C ʰ | — |
| 28 | Confidential prayer requests & anonymous identities | — | V G | V G | — | — | — | — | — | — | — |
| 29 | Devotional gatherings & rosters | M G | V | V | V | V | V | CE T ᶠ | M T | V | V |
| 30 | Worship teams & serving roles | M | V | — | V | — | — | M M | M T | — | V |
| 31 | Reports (status level) | VX G | VX G | V G | VX G | VX B | VX D | VX M | VX T | VX C | V (scope) |
| 32 | QR entry codes | M | — | — | M | M (own) | M (own) | — | — | M C | — |
| 33 | Notification templates & channels | M | — | — | E | — | — | — | — | — | — |
| 34 | Users & role assignments | M ⁱ | CE (leader, pastoral roles) | — | V | — | — | — | — | — | — |
| 35 | System settings | M | E (journal policy) | — | — | — | — | — | — | — | — |
| 36 | Audit log | VX | V (access log) | — | — | — | — | — | — | — | — |
| 37 | Break-glass access | A (self, 24 h, reason) | — | — | — | — | — | — | — | — | — |

**Notes**
- **a — Leader status depth.** Your brief says a Leader sees their *directly assigned* people, so the default is depth 1. Once disciples start leading their own groups, I recommend setting `hierarchy.leaderStatusDepth` to *unlimited* so leaders can see **status** (never content) for their whole downline. README decision D4.
- **b** — Leaders can't move people. They can request moves and approve incoming requests.
- **c** — No pastoral content for Super Admins by default. **Break-glass** creates a 24-hour, reason-required assignment; all Pastors are notified, and it is highlighted in the access review.
- **d** — Primary Leaders read content only for their own direct group by default (`journal.policy.contentVisibilityDepth = 1`). Raising the depth lets them read their whole branch. BR-J-11 always applies (content follows the relationship at the time of writing).
- **e** — Administrators see follow-up *summaries* (who, why, since), never resolution notes.
- **f** — Only for chains / gathering types owned by their ministry, when granted.
- **g** — Leaders see prayer participation of *their people* (profile tab), not the whole chain board.
- **h** — Coordinators see reports for their chains, excluding confidential fields and anonymous identities.
- **i** — Super Admins may assign any role. Assignments that include pastoral permissions notify all Pastors immediately and appear in the quarterly access review.
- **j** — *Leader directory (implemented in M1).* Anyone with `people.view` can find, **by name only**, leaders who receive new people (`accepts_members`). This is the same information the public leader selector will show (FR-JRN-05), and it lets a leader request a transfer to a leader outside their own scope. No contact details, group members or journal data are exposed.
- **m** — *Journal proof photos (M2 extension, 2026-09-21).* A photo of a written journal is a separate permission (`journal.proof.view`) from the typed answers, so the ministry can decide separately who reads words and who sees handwriting. It is granted to the same people as standard content by default: pastors and pastoral care ministry-wide, a leader and Primary Leader for their own direct group. Removing a photo (`journal.proof.manage`) is pastoral and global, so it is not something a leader — or the Super Admin, who holds no pastoral content — can do.
- **k** — *Devotional scope (implemented in M4).*
  - **Seeing:** a `devotional.view` grant in any scope shows every gathering and roster (row 29 "V"), because rosters are shared openly in the ministry.
  - **Managing:** `devotional.manage` needs a global grant, a grant for the gathering type's ministry, or a grant for the gathering type itself (the new `gathering_type` scope). Other gatherings return `NOT_FOUND`.
  - **Teams:** `devotional.teams.manage` covers the teams in the grant's ministry or team. For a Worship Coordinator it covers the teams their gathering types rotate, and the teams in those gathering types' ministries. Serving roles are one shared vocabulary, so anyone with `devotional.teams.manage` may add or rename them.
  - **Worship Coordinator bundle:** `people.view`, `people.contact.view`, `devotional.view`, `devotional.manage`, `devotional.teams.manage`, `care.view`, `care.manage`, `reports.view` and `reports.export`, scoped to one gathering type. For people, follow-ups and reports, that scope means anyone on the gathering type's rosters and the active members of the teams its schedules rotate.
  - **Ministry Heads** now hold `devotional.teams.manage` (row 30). `devotional.manage` stays "when granted" for them (note f).
  - **Appointing:** Worship Coordinators are appointed on the gathering's setup page by someone with global `iam.users.manage`.
  - **Adding people** to rosters and teams searches confirmed people by name and person code only, as in note j.
  - **Worship teams page (row 30, since M5):** open to holders of `devotional.teams.manage` and of a global `devotional.view`. Leaders and Prayer Chain Coordinators see rosters but not the teams list. Pastoral Care, being global, can open it too, although row 30 says "—". Why someone is away is shown only to people who look after that team.
- **l** — *Ministry structure (implemented in M5).* Structure isn't sensitive, so any `ministries.view` grant scoped to people shows every ministry, department and team (row 11 "V"). That covers a branch, a prayer chain or a gathering type. A grant scoped to a ministry keeps a Ministry Head to their own. Member lists are always narrowed to the people the viewer may see (`people.view`). The Prayer Chain Coordinator bundle gained `ministries.view` and `devotional.view` to match rows 11 and 29.

### Participant (no login) capabilities
| Capability | Allowed |
|---|---|
| Register self | C (quarantined as Unconfirmed) |
| Submit own journal | C (own) |
| Edit own journal | E (own, remembered device, within edit window) |
| View own journal history | V (own, remembered device, last 7 entries) — V1 |
| Respond to own prayer / serving assignments | E (own, via token or device key) |
| Request a leader change | C (request only) |
| Anything else | — |

---

## 3. Sensitive data: who sees what (default policy)

| Data class | Direct leader (LD) | Primary leader (PL) | Pastor (PX) | Pastoral care (PC) | Administrator (MA) | Super Admin (SA) | Coordinators |
|---|---|---|---|---|---|---|---|
| Journal **status** | ✅ group | ✅ branch | ✅ all | ✅ all | ✅ all | ✅ all | — |
| Journal **standard** content | ✅ (BR-J-11) | ✅ own group ᵈ | ✅ | ✅ | ❌ | ❌ ᶜ | ❌ |
| Journal **restricted** content | ✅ | ✅ own group | ✅ | ✅ | ❌ | ❌ ᶜ | ❌ |
| Journal **confidential** content | ❌ ("1 private answer shared with the pastoral team") | ❌ | ✅ | ✅ | ❌ | ❌ ᶜ | ❌ |
| Leader review comments | ✅ own | ✅ own group | ✅ | ✅ | ❌ | ❌ | ❌ |
| Prayer reports / testimonies | ❌ | ❌ | ✅ | ✅ | ❌ | ❌ | ✅ own chains (non-confidential) |
| Confidential prayer requests, anonymous identity | ❌ | ❌ | ✅ | ✅ | ❌ | ❌ | ❌ |
| Pastoral notes | ❌ | ❌ | ✅ | ✅ | ❌ | ❌ | ❌ |
| Contact details | ✅ group | ✅ branch | ✅ | ✅ | ✅ | ✅ | ✅ participants in scope |

Every ✅ in the content rows is logged in the access log. Every role with a content ✅ requires 2FA.

---

## 4. Permission catalog (seeded keys)

`⚠` = sensitive (2FA, access-logged) · `✝` = pastoral (grants notify Pastors)

| Module | Permissions |
|---|---|
| People | `people.view` · `people.contact.view` · `people.create` · `people.edit` · `people.contact.edit` · `people.archive` · `people.merge` ⚠ · `people.export` ⚠ · `people.registrations.confirm` · `people.links.issue` · `import.manage` ⚠ |
| Hierarchy | `hierarchy.view` · `hierarchy.manage` · `hierarchy.requests.decide` |
| Ministries | `ministries.view` · `ministries.manage` · `ministry.structure.manage` · `ministry.members.manage` |
| Journal | `journal.status.view` · `journal.content.view` ⚠✝ · `journal.content.restricted.view` ⚠✝ · `journal.content.confidential.view` ⚠✝ · `journal.proof.view` ⚠✝ · `journal.proof.manage` ⚠✝ · `journal.review` · `journal.proxy_submit` · `journal.excuse` · `journal.settings.manage` · `forms.manage` · `forms.publish` |
| Care & notes | `care.view` · `care.manage` · `care.pastoral.view` ⚠✝ · `notes.leadership.view` · `notes.leadership.create` · `notes.pastoral.view` ⚠✝ · `notes.pastoral.create` ⚠✝ |
| Prayer | `prayer.view` · `prayer.manage` · `prayer.assign` · `prayer.resolve` · `prayer.reports.view` ⚠ · `prayer.requests.confidential.view` ⚠✝ |
| Devotional | `devotional.view` · `devotional.manage` · `devotional.teams.manage` |
| Reports | `reports.view` · `reports.export` ⚠ |
| Links | `links.manage` · `links.own.manage` |
| Notifications | `notifications.manage` |
| IAM | `iam.users.view` · `iam.users.manage` ⚠ · `iam.roles.manage` ⚠ · `access.break_glass` ⚠ |
| Settings & audit | `settings.view` · `settings.manage` ⚠ · `audit.view` ⚠ · `audit.view.entity` |

---

## 5. Authorisation algorithm

```ts
// Every service call. Pure function of (actor grants, permission, resource, policy settings).
function can(ctx: RequestContext, permission: PermissionKey, resource: Resource): boolean {
  if (ctx.actor.kind !== 'user') return participantRules(ctx, permission, resource);
  if (isSensitive(permission) && !ctx.actor.twoFactorVerified) return false;

  return ctx.actor.grants
    .filter(g => g.permission === permission)                  // expired/revoked grants never loaded
    .some(g => scopeContains(g.scope, resource) && resourceRules(ctx, permission, resource, g));
}

// branch scope → one indexed probe: closure(anchor, resource.personId) with depth ≤ maxDepth
// ministry/team/chain/gathering-type scope → membership/ownership lookup
// resourceRules(journal.content.*): sensitivity tier + contentVisibilityDepth + BR-J-11 snapshot rule
```
**List queries** never post-filter in memory. They are built with `scopeFilter(ctx, permission)`, which adds the SQL join/predicate (e.g. `JOIN hierarchy_closure c ON c.descendant_id = p.id AND c.ancestor_id = :anchor AND c.depth BETWEEN 1 AND :maxDepth`), so out-of-scope rows are never selected.

---

## 6. Permission test implications (examples from the automated suite)

The suite builds a fixture ministry (2 Primary Leaders × 3 Leaders × 4 members, entries in all three sensitivity tiers, two prayer chains, one devotional schedule) and asserts every row of §2 for every role against **in-scope, sibling-branch, ancestor, and unrelated** targets.

| # | Scenario | Expected |
|---|---|---|
| T1 | Leader A opens `/app/journal/{personOfLeaderB}/{date}` by editing the URL | **404**, no content in the payload, no access-log entry for content |
| T2 | Leader A calls the `journal.getEntry` server action directly with Leader B's person id | `NOT_FOUND` |
| T3 | Leader A's people search with `leaderId = LeaderB` | Empty result (not an error), no rows outside scope |
| T4 | Primary Leader reads a sub-leader's member's entry (depth 2) with default policy | `NOT_FOUND`; status row visible |
| T5 | Same after `contentVisibilityDepth = 2` | Standard + restricted visible; confidential hidden with count |
| T6 | Pastor reads a confidential answer | Visible; access log written; requires 2FA session |
| T7 | Super Admin reads any journal content | `NOT_FOUND`; break-glass → visible for 24 h; Pastors notified |
| T8 | Administrator exports the people directory | Allowed; contact columns included; export audited |
| T9 | Administrator tries to open journal content | `NOT_FOUND` |
| T10 | Leader tries `hierarchy.move` | `FORBIDDEN` |
| T11 | Primary Leader moves a person from their branch into another branch | `NOT_FOUND` (target outside scope) |
| T12 | MA tries to grant the Leader role (contains content permissions MA doesn't hold); a Pastor tries to grant Ministry Administrator (contains import/merge the Pastor doesn't hold) | `FORBIDDEN` (a Pastor granting Leader succeeds) |
| T13 | After a transfer, the previous leader opens an old entry | `NOT_FOUND` (BR-J-11); the new leader sees only entries from the transfer date |
| T14 | Prayer Coordinator of chain X opens chain Y's board | `NOT_FOUND` |
| T15 | Participant device key of John submits with a crafted `personId` of Mary | Ignored: identity always comes from the key; entry is John's |
| T16 | Action token for assignment 1 used to respond to assignment 2 | `NOT_FOUND` |
| T17 | Revoked role assignment, session still open | Next request denied (grants loaded per request, never cached across requests) |
| T18 | Sensitive permission without 2FA-verified session | Denied with a 2FA prompt |

**Implementation note (M5, 2026-09-17): the permission suite.** `tests/integration/permission-matrix.test.ts` has two parts:
- **Role bundles against the matrix:** every permission fits its role's scope type (the check found `ministries.view` and `devotional.view` in branch-scoped bundles, fixed in note l). It also checks the sensitive (⚠) and pastoral (✝) markers of §4, who may read each tier of content, and that the Viewer is read-only.
- **Generated scope checks:** every permission of the Leader, Primary Leader and Pastor bundles is evaluated against all seven people of the fixture ministry, one person at a time and as a list query, with depth caps applied. That's over 500 cells, compared with the tree rather than with the implementation.

Where each scenario above is tested:

| # | Test |
|---|---|
| T1, T2 | `journal-portal.test.ts`: another leader's member's entry is `NOT_FOUND` (pages call the same service) |
| T3 | `people.test.ts` (search) and the generated list queries |
| T4, T5, T13 | `journal-content-access.test.ts`: status only above the direct leader, widening by setting, and reading after a move |
| T6 | `journal-portal.test.ts`: confidential answers for pastors only, with an access-log entry |
| T7, T9 | The bundle checks: no content permission for Super Admin or the office. Break-glass access isn't built yet |
| T8 | `people-export.test.ts` |
| T10, T11 | `hierarchy.test.ts` |
| T12 | `iam.test.ts` |
| T14 | `prayer.test.ts` and `devotional.test.ts` |
| T15 | By design: public routes take identity only from the device key and never accept a person id |
| T16 | By design: a token carries its own assignment. `prayer.test.ts` refuses another person's assignment id |
| T17 | `permission-matrix.test.ts`: a revoked role gives no grants on the next request |
| T18 | `iam.test.ts` and `permission-matrix.test.ts` |
