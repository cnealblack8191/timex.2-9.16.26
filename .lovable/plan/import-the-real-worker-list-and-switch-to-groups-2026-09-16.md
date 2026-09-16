# Import the real worker list and switch to Groups

Replace the 50 sample workers and the 8 sample divisions with the 209 people and 8 groups from your uploaded file, and rename "Division" to "Group" everywhere in the portal.

## Groups (from your file)

| Group | People |
| --- | --- |
| FIELD TEAM | 102 |
| TEMPS PREMIER K12 | 45 |
| PAYROLLERS | 29 |
| OFFICE TEAM | 26 |
| TEMPS OUTSOURCE | 4 |
| TEMPS BORROWED | 1 |
| TEMPS PROFORCE STAFFING | 1 |
| TEMPS PREMIER BS LV | 1 |

The old list (Commercial, Industrial, Low Voltage, Payroll, Residential, Service, Subcontractor, Utility) is removed.

## Workers

- All 209 people imported, all marked active (the file lists every one as active).
- Names kept exactly as written in the file, including tags such as "Alejandre Moedero TEMP PRMR K12".
- Nobody starts with an assigned job; you assign jobs afterwards in Admin.
- The 13 existing jobs stay as they are.

## What gets removed

- The 50 sample workers and their 129 sample time punches.
- The 8 sample divisions.
- Nothing touches your sign-in accounts or the jobs list.

## Wording change

Every place that says "Division" or "Divisions" becomes "Group" / "Groups": Admin tabs and filters, bulk assign, reports grouping and report headings, payroll sorting and exports, user permissions screen, and the kiosk. Anyone you had granted division access to keeps the same access under the new name.

## Technical notes

- Data change via SQL: delete sample `time_entries` and `employees`, delete existing `divisions`, insert the 8 groups with short codes (FIELD, TPK12, PAYR, OFFICE, TOUT, TBOR, TPRO, TPBSLV), then insert 209 `employees` rows linked to the correct group.
- The `divisions` table, `user_divisions`, and the permission functions keep their current names in the database — this is a UI-label change only, so no schema migration and no RLS/policy changes are needed.
- Files touched for labels: `src/routes/_authenticated/admin.tsx`, `operations.tsx`, `time-entries.tsx`, `payroll.tsx`, `reports.tsx`, `pto.tsx`, `src/components/UsersSection.tsx`, `src/components/TimeCardPanel.tsx`, `src/lib/reporting.ts`, `src/lib/employee-report-pdf.ts`, `src/routes/kiosk.tsx`.
- The email/username columns in your file are not imported; workers have no logins in TimeX.
