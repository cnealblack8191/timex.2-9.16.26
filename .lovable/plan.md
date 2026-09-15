# Holiday pay + overtime rule

## The rule being enforced

Overtime is earned only on hours actually worked. An employee must work more than 40 real hours in the Monday–Saturday payroll week before any overtime applies. Holiday, PTO, and Vacation hours are paid and appear in the employee's weekly total, but they never count toward the 40-hour threshold and never create overtime on their own.

Example: 32 worked + 8 PTO = 40 total hours paid, 0 overtime.

## What changes

**Holiday becomes its own paid category**, alongside PTO and Vacation:
- Payroll report gets a Holiday column next to PTO and Vacation, plus a Holiday hours summary tile.
- CSV and PDF exports both get a Holiday column and a Holiday total row.
- The PTO & Vacation page gets Holiday as a third choice, so holiday can be entered for one employee or a whole division at once. The page is retitled "Paid Time".
- The weekly Time Card gets a Holiday row under the PTO and Vacation rows.

**Overtime math is corrected:**
- The "Overtime hours" tile at the top of the Payroll page currently adds PTO and Vacation into the overtime calculation. It will be fixed to use worked hours only, matching the per-employee rows, which are already correct.
- Regular hours stay capped at 40 worked hours; holiday/PTO/vacation are reported separately and are never reclassified as regular or overtime.
- Totals shown per employee remain worked + holiday + PTO + vacation.

## Technical notes

- `time_entries.entry_type` is a free-text column with existing values `work`, `pto`, `vacation`; adding `holiday` needs no database migration.
- `EntryType` in `src/lib/timekeeping.ts` gains `"holiday"`.
- `src/routes/payroll.tsx`: add `holidayHours` per row; fix the overtime tile to `max(0, workTotal - 40)` summed across rows; add the column to the table, CSV header/lines, and the PDF head/body/foot arrays.
- `src/routes/pto.tsx`: widen the type toggle to three options.
- `src/components/TimeCardPanel.tsx`: extend `RowKind`, `rowKindOf`, the fixed row list, and the paid-row rendering loop to include `holiday`.
- Sorting rules stay as they are: division, then name, with zero-total employees at the bottom; inactive employees stay off the report.
