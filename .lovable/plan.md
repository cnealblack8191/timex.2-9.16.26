# Weekly Time Card on Time Entries

## Goal

On the Time Entries page, each employee row gets a **Time Card** button. Clicking it opens a weekly time card panel (like the reference screenshot): jobs as rows, days of the payroll week (Mon–Sat) as columns, editable hour cells, PTO/Vacation rows, totals row, and Save.

## What you'll see

- A "Time Card" button on every row of the Time Entries table.
- Clicking it opens a large card (overlay panel) for that employee showing:
  - The week date range with prev/next week arrows and a "Today" button.
  - One row per job the employee worked that week, plus empty rows with a job dropdown to add time to other jobs.
  - PTO and Vacation rows at the bottom.
  - A totals row (per day + job totals on the right), matching the reference layout.
  - A notes field and Save / Reset / Close actions.
- Existing kiosk punches come pre-filled: each day's hours appear in the right job cell, so you see the real week at a glance.
- Hours typed as plain numbers (e.g. `7.5`); displayed as `7:30`-style H:MM like the screenshot.

## Behavior rules

- Saving writes one work entry per filled day/job cell:
  - If a punch already exists for that employee/day/job, its hours are updated and the entry is marked as edited (reason noted).
  - If no entry exists, a manual entry is created (marked as manually entered).
- Clearing a cell back to zero does not delete an existing punch — to remove one, the existing Edit/Delete flow on the row stays available.
- PTO/Vacation cells create or update the matching PTO/vacation entries (8h standard, or the hours typed).
- All saves require a short reason note (consistent with the adjustments rule) — a reason field is included before Save.
- The main Time Entries table refreshes live after saving.

## Technical details

- `src/routes/time-entries.tsx`: add a `Time Card` action per row and render a new `TimeCardPanel` overlay when an employee is chosen.
- New component `src/components/TimeCardPanel.tsx`:
  - Reuses existing helpers from `src/lib/timekeeping.ts` (`weekStart`, `weekEnd`, `toDateKey`, `entryHours`, `fetchEntriesBetween`).
  - Loads the selected employee's entries for the displayed week, groups by job + day, converts to H:MM display.
  - Cell grid: jobs (union of jobs with entries + manually added rows), plus fixed PTO and Vacation rows; Mon–Sat columns.
  - Save computes diffs vs. loaded entries and applies update/insert via Supabase; requires a non-empty reason.
  - Week navigation re-fetches entries for the new range.
- No database schema changes — uses existing `time_entries` columns (`edited`, `job_overridden`, `entry_type`, `notes`).

## Verification

- Typecheck + build clean.
- Browser test: open Time Entries, click Time Card on an employee with punches, confirm pre-filled hours; edit a cell, add a job row, enter PTO hours, save with a reason; confirm the table and Payroll totals update.
