# Holiday pay, overtime rule, and removing Vacation

## The rule being enforced

Overtime is earned only on hours actually worked. An employee must work more than 40 real hours in the Monday–Saturday payroll week before any overtime applies. Holiday and PTO hours are paid and appear in the employee's weekly total, but they never count toward the 40-hour threshold and never create overtime on their own.

Example: 32 worked + 8 PTO = 40 total hours paid, 0 overtime.

## What changes

**Vacation pay is removed** from the whole app: the Vacation column and summary tile on the Payroll report, the Vacation column in the CSV and PDF exports, the Vacation choice on the paid-time entry page, and the Vacation row on the weekly Time Card.

**Holiday becomes its own paid category**, alongside PTO:
- Payroll report gets a Holiday column next to PTO, plus a Holiday hours summary tile.
- CSV and PDF exports get a Holiday column and a Holiday total.
- The paid-time page offers PTO or Holiday, for one employee or a whole division at once. It is retitled "PTO & Holiday".
- The weekly Time Card gets a Holiday row beneath the PTO row.

**Overtime math is corrected:**
- The "Overtime hours" tile at the top of the Payroll page currently folds paid-leave hours into overtime. It will use worked hours only, matching the per-employee rows, which are already correct.
- Regular hours stay capped at 40 worked hours; holiday and PTO are reported separately and never reclassified as regular or overtime.
- Employee totals become worked + holiday + PTO.

### Existing vacation records

Any time entries already recorded as vacation stay in the database untouched, but stop appearing on the report. If you'd rather I convert them to Holiday or PTO, say which and I'll add that step.

## Technical notes

- `time_entries.entry_type` is free text with existing values `work`, `pto`, `vacation`; adding `holiday` and retiring `vacation` needs no database migration.
- `EntryType` in `src/lib/timekeeping.ts` becomes `"work" | "pto" | "holiday"`.
- `src/routes/payroll.tsx`: replace `vacationHours` with `holidayHours`; fix the overtime tile to sum `max(0, workTotal - 40)`; update the table, CSV header/lines, and PDF head/body/foot arrays.
- `src/routes/pto.tsx`: type toggle becomes `pto | holiday`; page title/description/meta updated.
- `src/components/TimeCardPanel.tsx`: `RowKind`, `rowKindOf`, the fixed row list, and the paid-row loop swap `vacation` for `holiday`.
- `src/routes/index.tsx`: tile copy for the paid-time page updated.
- Sorting stays as-is: division, then name, zero-total employees last; inactive employees stay off the report.
