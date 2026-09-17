# Runbook: backups and recovery

> What is backed up, what to do when something is lost or broken, and how the restore is rehearsed.
> Companion: [deployment.md](deployment.md). Milestone M5.6 (docs/07-roadmap.md).
> Blanks marked ✎ are decisions for the ministry.

## 1. What is backed up, and a decision to make

Supabase takes the backups; the app takes none of its own. What you get depends on the plan:

| Plan | Backups | If a mistake is noticed at 3 PM |
|---|---|---|
| Free | Daily snapshot | You can go back to last night. Today's journals are gone |
| Pro (paid) | Daily snapshot **plus point-in-time recovery** | You can go back to 2:55 PM, losing minutes rather than a day |

**Decision ✎:** which plan. For a ministry recording ~1,900 people's daily journals, point-in-time recovery is the difference between losing a day of people's writing and losing five minutes of it. Record the choice here, with the date: ✎

**Targets ✎** (proposed; confirm or change):

| | Proposed | Meaning |
|---|---|---|
| How much data we accept losing | **5 minutes** with point-in-time recovery, otherwise 24 hours | The gap between the last recoverable moment and the failure |
| How long recovery should take | **2 hours** | From deciding to restore, to leaders using the app again |

Also worth knowing: the daily snapshot is not an export you hold. If the ministry wants a copy it controls, run `pg_dump` monthly and keep it somewhere separate (see §5), because the same account holding the app and its backups is a single point of failure.

## 2. First question: is this a data mistake or a broken system?

Almost every real incident is the first kind, and restoring a backup is the wrong tool for it.

| What happened | Go to |
|---|---|
| Someone archived, moved or edited the wrong person; an import went in wrong | §3 — fix it in the portal |
| A release misbehaves | Roll back the deployment ([deployment.md](deployment.md) §6) |
| The database is unreachable, corrupt, or genuinely lost | §4 — restore |
| A secret may have leaked | §6 |
| The only administrator cannot get in | §7 |
| Journal answers were visible to the wrong person | §8 — treat as a privacy incident first |

## 3. A data mistake (the common case)

**Do not restore the whole database.** A restore rewinds *everyone*: every journal written since the backup disappears, including the ones nobody wanted undone.

1. Find out what actually happened. Each person's profile has an **Activity** list (who changed what, when), and archiving, moving and importing are all audited.
2. Undo it in the portal: move the person back, edit the field, or restore what the import changed. Most of M1's structure edits are reversible by hand.
3. If a whole import went wrong, work from `import_jobs` and `import_rows`: they record exactly which people that run created.
4. Only if hundreds of rows are wrong and the portal cannot undo them, consider §4 — and then prefer restoring into a **second** database and copying the affected rows across, rather than rewinding production.

## 4. Restoring the database

Decide and announce first: **everything written after the restore point will be gone.** Tell the leaders which window is lost, so people can re-send that day's journal.

1. **Stop writes.** Pause the background jobs (`select cron.unschedule('gentouch-background-jobs');`) and ask the leaders to stop using the app until you say otherwise. There is no maintenance mode yet (V1), so this part relies on telling people.
2. **Restore**, in Supabase's dashboard: Database → Backups → either the snapshot or a point in time. Supabase restores into the same project.
3. **Check the copy is whole**, from your laptop:
   ```bash
   npm run db:check -- "<session pooler URL>"
   ```
   Seven checks: every migration applied; reference data present; exactly one active general QR code; the closure table matches the leadership tree row for row, with the right depths and primary leaders; no node whose leader is missing; no journal answers without their ledger day; and a contents summary (people, portal users, ledger days, journals) to compare with what you expect.
4. **Re-enable the scheduler**: re-run `deploy/supabase-cron.sql`'s `cron.schedule` block.
5. **Check the app**: `npm run smoke -- https://<production URL>`, then the System health page for job runs.
6. **Tell people** what window was lost, and ask the pilot branch to re-send journals for it.
7. **Write down** what happened and why, in a note here with the date ✎.

## 5. A copy the ministry holds itself

Monthly, or before anything large (a full import, a rollout):

```bash
docker run --rm -e PGPASSWORD="<password>" postgres:17 \
  pg_dump --format=custom --no-owner --no-privileges -h <host> -U <user> -d postgres -f gentouch-YYYY-MM-DD.dump
```

Keep it somewhere that is not the Supabase account, and treat it as the most sensitive file the ministry holds: it contains every journal answer. Encrypt it at rest, and delete old copies on a schedule the privacy notice allows.

To read one back into a scratch database:

```bash
pg_restore --no-owner --no-privileges --exit-on-error -d "<scratch database URL>" gentouch-YYYY-MM-DD.dump
npm run db:check -- "<scratch database URL>"
```

## 6. A leaked secret

| Secret | What to do | What the ministry notices |
|---|---|---|
| `BETTER_AUTH_SECRET` | Replace it in Vercel and redeploy | Everyone signs in again with a fresh magic link |
| `APP_ENCRYPTION_KEY` | Replace it, then every leader re-enrols two-step verification | Authenticator apps stop working; the codes they hold are encrypted with the old key. Personal links and remembered phones are unaffected — those are plain hashes |
| `CRON_SECRET` | Replace it in Vercel **and** in Supabase Vault (`select vault.update_secret(...)`) | Nothing, if both are changed together. Jobs stop until they match |
| `EMAIL_API_KEY` | Revoke it in Resend and issue a new one | Sign-in emails stop until the new key is set |
| Database password | Rotate `app_rw`'s password in Supabase, update `DATABASE_URL` | Brief errors while the deployment updates |
| A leader's QR code | Replace the code from their profile's QR page | Their group's printed cards stop working, so print again |

## 7. Nobody can get in

- **Another Super Admin** can clear a lost second factor from Users & Permissions.
- If there is only one administrator and they have lost their authenticator, clear it directly, from a psql session on the session pooler:
  ```sql
  DELETE FROM user_two_factors WHERE user_id = (SELECT id FROM users WHERE email = 'them@example.org');
  ```
  They can then sign in with a magic link and enrol again. This is deliberately outside the app and leaves no audit entry, so note here who did it and why ✎. **Invite a second Super Admin so this is never needed.**

## 8. A privacy incident

If journal answers were visible to someone the settings do not allow, this is the most serious thing in the system (docs/01: the target is zero such incidents).

1. Close the hole first — remove the role or setting that allowed it.
2. Tell the Senior Pastor and the Data Protection Officer the same day.
3. Gather the facts from the audit and access logs: who read what, and when. Journal reads are access-logged.
4. The Data Protection Officer decides, with counsel, whether the National Privacy Commission and the people affected must be told. Religious information is sensitive personal information under RA 10173 and the deadline can be 72 hours from discovery.
5. Do not delete anything while this is being worked out, including the logs.

## 9. How the restore is rehearsed

- **On every push**, CI runs a *Backup and restore drill*: it builds a database with the real schema, reference data and a ~1,900-person demo ministry, dumps it with `pg_dump`, restores it into an empty database with `pg_restore`, runs `npm run db:check` against the copy, and fails if any counted table differs from the original. This proves the mechanics keep working as the schema changes.
- **Quarterly** ✎, rehearse the real thing: restore the production backup into a scratch Supabase project, run `npm run db:check` against it, and time how long it took. Write the date and the timing here — an untested backup is not a backup.

| Drill | Date | Time taken | By |
|---|---|---|---|
| CI drill | every push | ~2 min | automated |
| Production restore rehearsal | ✎ | ✎ | ✎ |
