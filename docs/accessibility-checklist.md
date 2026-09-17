# Accessibility — manual test checklist

> Companion to docs/07-roadmap.md §7 ("Accessibility"). Automated coverage (axe-core, WCAG 2.2 AA,
> a skip link, 200% zoom) runs in `tests/e2e/portal.accessibility.spec.ts` and
> `public.accessibility.spec.ts`, in CI on every push. This document is what a machine can't check:
> a person, using a screen reader, going through the flows that matter most. It hasn't been run yet
> — do this before the pilot.

## Before you start

- **TalkBack** (Android): a low-cost Android phone or emulator, Settings → Accessibility → TalkBack.
- **VoiceOver** (iPhone/Mac): Settings → Accessibility → VoiceOver (iPhone), or Cmd+F5 (Mac Safari).
- Turn the screen reader on, then try to do each flow **by sound alone** — resist looking at the
  screen. If you get lost or hear something confusing, that's a finding.
- Log every finding as: page, what you heard, what you expected, and how bad it is (blocks the
  task / confusing but workable / minor).

## Public pages (the ones members use, no login)

Run these on both TalkBack and VoiceOver, since the two announce things differently.

- [ ] **`/j` — first-time registration.** Can you find and fill every field, including the ministry
      and leader pickers, from announcements alone? Is the "under 18 → guardian consent" step
      announced when it appears?
- [ ] **`/j` — sending a journal.** Are the question type, its label, and (for choice questions)
      the options all announced? Is a required-field error read out after a failed submit, without
      having to hunt for it?
- [ ] **`/j/{code}` and `/pray/{code}` — a leader's or chain's QR page.** Is it clear whose page
      this is before you're asked to identify yourself?
- [ ] **A personal link (`/a/{token}` or `/k/{token}`).** Confirming a prayer slot or a serving
      assignment: is the single confirm button clearly labelled with what it does (not just
      "Confirm")? Is the result (confirmed / declined / already used) announced?
- [ ] **`/privacy`.** Do headings let you jump between sections with a rotor/heading-navigation
      gesture, instead of reading the whole notice start to finish?

## Portal pages (leaders, coordinators, pastors, admins)

- [ ] **Sign in.** Magic-link request, "check your email" state, and (for 2FA accounts) the code
      entry — all readable and in a sensible order.
- [ ] **Dashboard.** Are the progress bars (journals received, chain coverage) announced with a
      number, not just a shape? (They use `role="progressbar"` with `aria-valuenow` — confirm it's
      actually spoken.)
- [ ] **People list and search.** Can you filter, read a row's status, and open a profile?
- [ ] **Add / edit a person form.** Every field has a label; a validation error is announced right
      after you try to submit (not just shown in colour).
- [ ] **Leadership tree.** Expanding a branch: is the new content announced, and does focus land
      somewhere sensible (not lost back at the top of the page)?
- [ ] **Daily Journal review queue.** Reviewing one entry, moving to the next with a keyboard
      shortcut — is the new entry's content announced automatically, or do you have to go looking?
- [ ] **Prayer chain board and Devotional roster.** Assigning someone (search, pick from results,
      confirm): every step nameable and confirmable by ear. Warnings (overlap, unavailable) read
      out, not just shown as a coloured chip.
- [ ] **A dialog (e.g. "Share their link", "Cancel gathering").** Does focus move into the dialog
      when it opens, and back to what you were doing when it closes? Can you close it with Escape?
- [ ] **A dropdown menu (e.g. a row's "⋯" actions).** Announced as a menu, with its items readable
      and choosable by keyboard.
- [ ] **Settings.** Every toggle and select announces its current state and what it does (the hint
      text below each field) — try navigating by form field, not by reading everything.
- [ ] **Notifications inbox.** Is the unread count announced (in the sidebar badge and in the
      inbox itself), and is it clear which items are unread when reading the list?

## Keyboard only (unplug the mouse)

- [ ] Tab order on a page with a form follows the visual order (top to bottom, left to right)
      — including inside dialogs and dropdown menus.
- [ ] Nothing is reachable by mouse only: every button, link and form control gets a visible
      focus ring when tabbed to (check the brand-green focus ring shows up, including inside
      dark or tinted cards).
- [ ] No keyboard trap: you can always Tab or Escape your way out of a dialog or menu.

## What "done" looks like

Every unchecked box above is a task, not a pass/fail gate for the whole app — note the severity
and fix the ones that block a task first. Once this pass is done, record the date and findings
here (or link to wherever they're tracked), and update the docs/07-roadmap.md M5 row.
