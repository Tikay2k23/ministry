# Pilot plan: one branch, two weeks

> **Status:** draft for the Senior Pastor and the ministry office to confirm (2026-09-17).
> Part of M5 (docs/07-roadmap.md, "Pilot before rollout"). Exit criteria: the pilot branch uses the system daily for two weeks, issues are triaged, and there is a go/no-go decision for full rollout.
> Blanks marked ✎ are for the ministry to fill in.
> Materials: [leader quick start](leader-quick-start.md) · [video script](video-script.md) · printed QR cards (portal → **QR codes**).

## 1. What the pilot is for

Two weeks of real use by one branch, before about 1,900 people depend on the system. We want to learn four things:

1. **Members** can send their journal on their own phones, quickly and without help.
2. **Leaders** can see their group each day and care for people without it becoming a burden.
3. **The system** is dependable and private under daily use.
4. **The office** can support it.

The pilot tests the tool, not anyone's spiritual life. Journal numbers are used only to see whether the system works. They are never used to compare people, leaders or groups.

## 2. Scope

| In | Out (until rollout) |
|---|---|
| The Daily Journal for everyone in the pilot branch, with leader review, follow-ups, new registrations, personal links, journals recorded by phone, pauses and excused days | Other branches |
| The leaders' printed QR cards | **The general Daily Journal poster at the entrance.** People from other branches would scan it and register as new, creating duplicates that are hard to undo (merging people is V1). |
| Prayer Chain and Devotional, **only** for chains or worship teams the branch already takes part in | New reports or features (recorded for V1, see §10) |

**One way, not two.** From launch day, members use the system instead of the current way (paper, Messenger), not as well as it. Asking people to do both doubles the work and muddies what we learn. Anyone who can't use it tells their journal to their leader by phone, and the leader records it.

## 3. Choosing the branch

One Primary Leader's branch, about 150 people. Look for:

- A Primary Leader who wants to do it and can give it about 15 minutes a day for two weeks, plus the two meetings in §6.
- A realistic mix of people: older and less tech-confident members, youth (including under-18s, so the guardian step is tried), Android phones and iPhones, and prepaid data.
- Leaders who each have an email address they can open on their phone.
- A reasonably tidy member list: names, mobile numbers, who leads whom.
- No retreat, big event or leadership change in the branch during the two weeks.

Don't choose the branch most comfortable with technology. It would hide the problems the pilot is meant to find.

**Chosen branch** ✎ `________________` · **Launch date** ✎ `________________`

## 4. Roles

| Role | Who | During the pilot |
|---|---|---|
| Sponsor | Senior Pastor ✎ | Announces the pilot to the branch; makes the go/no-go decision |
| Pilot Primary Leader | ✎ | Champions it with the leaders; leads the Day 7 huddle |
| Pilot coordinator | Ministry office ✎ | First help for leaders (phone or Messenger); daily checks; keeps the issue log |
| Technical lead | Developer ✎ | Triage, fixes, releases, monitoring |
| Privacy contact | Data Protection Officer ✎ | Consulted on anything touching privacy; decides on breach notifications |

## 5. Readiness checklist

Every box must be ticked before launch day unless it says otherwise.

### System (M5 work still open on 2026-09-17)

- [ ] **Production deployment (M5.6)**, with daily backups and a restore tested on a scratch copy (the recovery drill in docs/07 §7).
- [ ] **Sign-in links on shared connections (docs/07, known M5 issues).** Raise the per-IP limit and store rate-limit counts in Upstash. If this isn't done yet, leaders **must** sign in at home before the onboarding session. Twelve people requesting links together on the church Wi-Fi will be refused after the fifth.
- [ ] **Error alerts reach the technical lead:** Sentry, and the job-failure emails from System health.
- [ ] **System health** shows the scheduler running and no failed jobs.
- [ ] **Email arrives:** send a sign-in link to a Gmail, a Yahoo and a church-domain address, and check that none lands in spam.
- [ ] **Screen-reader pass:** at least the public journal flows in `docs/accessibility-checklist.md`.
- [ ] Not required for the pilot, but required before full rollout: the M5.5 performance checks (a 150-person branch isn't a load risk) and the external penetration test (docs/07 §7).

### Privacy and consent

- [ ] **Privacy notice approved** by the pastors and the Data Protection Officer, and published in place of the draft (`src/app/(public)/privacy/page.tsx`, with a new `privacy.noticeVersion`). The public page currently says "Draft for review". Members agree to this notice when they register, so it can't launch as a draft.
- [ ] **Journal settings confirmed by the pastors** in **Settings → Daily Journal**: who reads answers (default: the direct leader), deadline (default 11:59 PM), late until (default 9:00 AM), and whether review is expected. In **Settings → Privacy**, also confirm whether young people take part.
- [ ] **Journal questions confirmed:** **Daily Journal → Questions**.
- [ ] **The branch is told before launch** what is collected, who can read it, and that the old way ends on launch day. The Sponsor does this on the Sunday before (§6).

### People and accounts

- [ ] **Branch imported:** **People → Import** with the pastors at the top, the Primary Leader, the leaders and the members. Check the preview with the Primary Leader. Import only this branch. At rollout the other branches are imported the same way, and rows can refer to people already in the system by person code, so no one is added twice.
- [ ] **Mobile numbers on record** for as many members as possible. A member without one can't be recognised with "I've journaled before". Their leader sends them a personal link for their first journal instead.
- [ ] People who shouldn't be expected to journal (small children, long absences) have it unticked on their record or a pause added.
- [ ] Leaders who receive new people have **Shown in leader selector** turned on (their profile, under their group).
- [ ] Each leader invited with the right role (Primary Leader or Leader) and a working email address.
- [ ] **Every leader signed in and turned on two-step verification** before the onboarding session, with help from the coordinator by phone if needed.
- [ ] **Baseline:** the Primary Leader estimates how many journals the branch sends in a typical week today, to compare with in §9.

### Materials

- [ ] **Cards printed:** **QR codes → Cards for a branch → Print**, four to an A4 page. Print at 100% scale, then test-scan one card from each page with a low-end Android phone.
- [ ] Quick-start guide filled in (portal address, coordinator) and shared with the leaders.
- [ ] Video recorded on demo data and shared privately.
- [ ] **End-to-end test on production:** a staff volunteer on a low-end Android phone with mobile data scans a printed card, registers, sends a journal, and their leader reviews it. Then archive the test person.

## 6. Schedule

| When | What | Who |
|---|---|---|
| Week −2 | Choose the branch; tidy the member list with the Primary Leader; import; invite leaders | Office, Primary Leader |
| Week −1 | Work through the readiness checklist; print cards; record the video; end-to-end test | Office, technical lead |
| Day −7 (the Sunday before) | The Sponsor tells the branch what is changing and why | Sponsor |
| Day −3 | **Leaders' onboarding** (§7) | Primary Leader, coordinator |
| **Day 1** (a Sunday) | **Launch**: after the gathering, a 5-minute demo on the screen, then each leader helps their group send a first journal from the leader's card and add the page to their home screen. A help table with the coordinator. | Leaders, coordinator |
| Days 1–3 | The coordinator checks every morning and evening: sign-in problems, **New registrations**, **System health**. The technical lead stays reachable. | Coordinator, technical lead |
| Days 3–6 | **Observe 5–8 members** (§8) | Coordinator |
| Day 7 | **Leaders' huddle**, 20 minutes (§8); triage week 1 | Primary Leader, coordinator, technical lead |
| Days 8–14 | Normal use; one fix release mid-week (§10) | Everyone |
| Day 14 | Feedback forms for leaders and members (§8) | Coordinator |
| Days 15–17 | **Review meeting and go/no-go** (§9) | Sponsor, all roles |

## 7. Leaders' onboarding session (60–90 minutes)

1. **Why (10 min, the Sponsor).** Care, not control; what stays private; what we're asking of leaders for two weeks.
2. **The video (3 min).**
3. **Check everyone is ready (15 min).** Signed in, with two-step verification on. Anyone who isn't: help them now, one or two at a time, on mobile data rather than the church Wi-Fi.
4. **Practice as a member (15 min).** Each leader scans **the Primary Leader's card**, taps **I've journaled before** and sends today's journal. Don't practise with your own card: it would ask whether you are now your own leader. One volunteer writes a short journal meant to be shown, and the Primary Leader reviews that one on the screen.
5. **The daily rhythm (15 min).** Dashboard, **Needs your attention**, review with a follow-up, **Follow-ups**, and the "Helping your people" table in the guide.
6. **Launch day (10 min).** Members already in the group tap **I've journaled before**, even the first time. **I'm new here** is only for people new to the ministry. After the first journal, add the page to their home screen. Who to call, and when.
7. **Hand out** the cards and the printed guide.

## 8. Listening

- **Issue log:** one shared sheet kept by the coordinator. Columns: date, reported by, what happened, phone and browser, severity (§10), status. Leaders report in their usual Messenger group; don't add a new channel.
- **Observed sessions (Days 3–6):** 5–8 members, including at least two older or less tech-confident members. Watch each one send the day's journal on their own phone without helping, unless they've been stuck for a minute (and note it). Record:
  - whether they finished alone
  - the time from opening the page to **Thank you**
  - where they hesitated
  - what they say was confusing
- **Leaders' huddle (Day 7):** three questions. What helped? What got in the way? What should change first?
- **Feedback forms (Day 14),** on paper or online, whichever the branch uses. Members may answer without their name.
  - Leaders:
    1. How long does your daily check take?
    2. Did it help you notice someone who needed care?
    3. What was confusing or slow?
    4. Did anything worry you about privacy?
    5. Should the whole ministry use it: yes, yes after changes, or not yet? Why?
  - Members:
    1. How easy was it to send your journal (1–5)?
    2. What made it hard, if anything?
    3. Would you keep using it or go back to the old way?

## 9. Go / no-go (Days 15–17)

**Go**, then roll out branch by branch, when all of these hold:

1. **No privacy incident:** no one could read journal answers the ministry's settings don't allow (docs/01 target: 0).
2. **No lost journals:** no confirmed case of someone seeing **Thank you** for a journal that didn't arrive.
3. **No open S1 or S2 issues** (§10).
4. **Members can do it alone:** at least 4 in 5 observed members sent a journal without help. Returning members are close to the docs/01 target of 30 seconds (first time: 90 seconds). Anything over a minute is a finding to fix before rollout.
5. **Leaders can keep up:** most leaders checked their group on most days in week 2 (from **Last sign-in** in **Users & Permissions**, the **Awaiting review** counts, and what they say), and they say it takes about 10 minutes a day or less.
6. **About as many journals as before:** compare week 2 with the baseline from §5. A drop is a finding to understand (Is it the tool? The change of habit?), not a verdict on anyone.
7. **Support is manageable:** help requests in week 2 are fewer than in week 1.

**Go after changes:** fix what the pilot found, then continue with **the same branch** for one more week and decide again. Choose this if members couldn't send on their own, leaders found it a burden, or support didn't settle.

**No-go:** an S1 issue that can't be fixed with confidence, or the Sponsor and the Primary Leader judge that the branch was better served the old way. Follow §11.

**Before full rollout (after a go):** the M5.5 performance checks pass, the restore drill has been done, and the external penetration test is booked or done. Then import the other branches, hold one onboarding session per group of branches, and put up the general entrance poster last.

## 10. Triage

| Severity | Examples | Response |
|---|---|---|
| **S1 · Stop** | Someone can read journals they shouldn't; a sent journal is lost; the site is down for everyone | The technical lead responds within an hour (7 AM–10 PM). Pause the pilot if needed; the Sponsor tells the branch. The Sponsor and the privacy contact are told the same day. The privacy contact decides, with counsel, whether the National Privacy Commission and the people affected must be notified: religious information is sensitive personal information under RA 10173, and the deadline can be 72 hours from discovery. |
| **S2 · Blocks someone** | A member can't send; a leader can't sign in or read journals; cards don't scan | Fix within 1–2 days. Meanwhile use a workaround: a personal link, a journal recorded by phone, or signing in on another device. |
| **S3 · Confusing or slow** | Unclear wording, an extra step, a slow page on mobile data | Logged; fixed in the mid-week release of week 2 |
| **S4 · Idea** | New reports, reminders, other features | Recorded for V1. Change requests wait unless they block the pilot (docs/07 §6). |

**Releases during the pilot:** S1 and S2 fixes as soon as the tests pass; everything else in one release mid-week in week 2. No new features. Tell the leaders in their group what changed.

## 11. Rollback

- **A release goes wrong:** promote the previous deployment on Vercel. Migrations are only ever additive, so the previous version should still run on the current database. If the release included a migration, the technical lead checks this before promoting.
- **A data mistake** (a wrong import row, a person under the wrong leader): correct it in the portal by moving, editing or archiving. Restore from a backup only for corruption or loss, following the M5.6 recovery runbook. A restore rewinds everyone's journals to the time of that backup.
- **Stopping the pilot** (no-go): the Sponsor tells the branch to return to the previous way from a given date. Export what leaders need first (**Reports**, CSV). Keep or remove the pilot data as the published privacy notice says, and honour any member's request to delete theirs. Record what was learned in docs/07 before planning another attempt.
