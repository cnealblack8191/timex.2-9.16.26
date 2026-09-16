# Payroll integrity pass — 2026-09-16

Second pass after the hardening work in `HARDENING_2026-09-16.md`. It closes
review items 10 to 13: forgotten clock-outs, the audit trail, deletes, and
closing a pay period. Decisions taken with ECI on 2026-09-16 are recorded
inline.

## What changed

### Every change is recorded (item 11)

A database trigger writes a row to `time_entry_revisions` on every insert,
update and delete of a time entry: the action, who did it (name and user id
for a signed-in person, otherwise the channel: web kiosk, mobile app, kiosk
adjustments, time card, cron), when, and the full before and after rows. Photo
housekeeping updates are skipped so the log only shows changes people care
about.

Time Entries has a **History** link on every row. Administrators see all
history; payroll users see it for the groups and people they can edit; view-only
users see the `adjusted` marker but not the log (decision: admins and payroll).
The panel shows, per change, the fields that differed with old and new values.

### Voided, never deleted (item 11, decision: void with admin restore)

**Delete entry** is gone. **Void entry** takes a required reason, keeps the row,
and marks it `voided` with who, when and why. Voided entries:

- drop out of hours, payroll, reports, the time card and the kiosk's open-punch
  list (every list read excludes them unless it asks for them);
- show greyed-out with a `Voided` badge on Time Entries, where a **Show voided**
  toggle hides them;
- can only be restored by an administrator (**Restore** on the row). The
  database enforces this; a voided entry cannot be edited by anyone until it is
  restored.

The authenticated role no longer has delete rights on `time_entries` at all.

### Reasons everywhere, appended not overwritten (item 12)

Time Entries corrections now require a reason, like the kiosk adjustments and
the time card already did. Every correction, void, restore and time card save
appends a dated, signed line to the entry's notes (`Corrected 9/16/26, 3:10 PM by
Charles Black: forgot to clock out`) instead of replacing what was there.

### Closing a payroll week (item 13, decision: payroll or admin closes, admin reopens, late punches flagged)

Payroll gains **Close week**. Payroll users and administrators can close the
week on screen; only an administrator can **Reopen** it. The state lives in
`pay_periods`, keyed by the week's Sunday, with who closed or reopened it and
when. Realtime keeps every open portal in step.

While a week is closed:

- office edits, voids, PTO entries and time card saves in that week are blocked
  for payroll and view-only users, by row level security, not only by the UI.
  Administrators can still correct, and every correction is in the history;
- the Time Entries banner, the PTO page and the time card say the week is
  closed and by whom;
- a **kiosk or mobile punch that lands in a closed week is still recorded**
  (nothing is lost) and flagged `after_close` by the database. Operations and
  Payroll show a count and the names, so payroll decides on a correction run;
- the supervisor Adjustments screen refuses to change a closed week and tells
  the foreman to call the office;
- the CSV and PDF exports carry the week status and export time in their
  header, so an export can be told apart from a later one.

### Forgotten clock-outs (item 10, decision: flag after 14 hours, never auto-close)

A work punch open longer than 14 hours is marked **Needs clock-out**:

- Operations lists those punches first, in amber, and shows a count that links
  to Time Entries. The "on site" count excludes them;
- Time Entries shows the badge in the Out column and a count in the header;
- Payroll shows a banner naming the people and a badge on their row, and the
  Close week confirmation warns about them.

Nothing is closed automatically; a person sets the time and the reason. The
threshold is `STALE_PUNCH_HOURS` in `src/lib/time-rules.ts`.

Also in this pass: PTO hours are validated (0 to 24); the Operations "This
week" tile now counts worked hours only, as labelled; Bulk Assign on Operations
is shown only to administrators, who are the only role allowed to use it;
browser tab titles name the page.

## Not done, by decision

- **Employee identifier for the import** (review item 16). No key has been
  agreed with the existing ECI system, so no `external_id` column was added.
  Decide before the first re-import.

## Manual steps after merging

1. **Apply the migration** `20260917020000_audit_void_close_weeks.sql`, the same
   way as the hardening one: check for the `pay_periods` table after merging and
   run the file in the SQL editor if it is missing. Every statement is guarded.
2. Nothing else. No new secrets, no new cron.

## How this was verified

- `npm run typecheck`, `npm run test` and `npm run build` pass. New tests cover
  the stale-punch rule, Sunday week starts across a year boundary, note
  appending, and the change-history diff.
- The Supabase project was not reachable from this environment, so the
  migration and the triggers were reviewed but not executed. On the preview:
  edit an entry without a reason (blocked), with one (History shows the
  change); void and restore an entry as admin, and confirm a payroll user
  cannot restore; close a week as payroll, try to edit it as payroll (blocked)
  and as admin (allowed, logged); punch from the kiosk into the closed week and
  check the `After close` badge; leave a punch open 14 hours or backdate one in
  the SQL editor and check the badges.

## Residual risks

- The change log begins at the day the migration runs. Earlier edits are known
  only through the free-text notes.
- Close and reopen keep only the latest cycle per week in `pay_periods`. The
  full sequence is recoverable from the entries' revisions if ever needed.
- A closed week does not freeze the export itself. If payroll re-runs the
  export after an administrator correction, the two files differ; the header
  timestamp shows which is newer. Storing the exported snapshot is a possible
  next step.
