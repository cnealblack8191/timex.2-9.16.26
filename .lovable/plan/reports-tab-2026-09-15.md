# Reports Tab

A new Reports section in TimeX with a visual overview plus a customizable report builder that prints or downloads as PDF or CSV.

## Payroll week change (important)

You said the payroll week runs Sunday through Saturday. Today the app treats it as Monday through Saturday (6 days). I will change the week everywhere to Sunday–Saturday (7 days): payroll report, time entries week view, weekly time card (adds a Sunday column), and the new reports. Overtime stays worked hours above 40 in that week; PTO and Holiday are paid but never count toward the 40.

## Overview page (Reports landing)

Four live tiles and charts, updating in real time:

- Clocked in right now — count plus the list of names, job, and time in.
- Clocked in this week — how many people recorded time this week.
- Hours per job — bar chart for the selected period.
- Regular vs Overtime vs PTO vs Holiday — donut/stacked chart with the totals.

Plus an hours-per-day trend line for the selected period.

## Report builder

Controls across the top:

- Group the report by: Employee, Division, Job, or Company total.
- Date range: payroll week arrows (Sun–Sat), or a custom start/end date, with presets for this week, last week, this month, last month, this year.
- Filters: division, job, employee, and an employee name search.
- Sort employees by last name or first name.
- Choose which columns to include: Worked, Overtime, PTO, Holiday, Total, plus optional per-job and per-day breakdowns.
- Optional detail level: summary rows only, or expanded rows showing each job (and each day) under the grouping.

Inactive employees are excluded, matching the payroll rule. Zero-hour employees sort to the bottom.

## Print, PDF, CSV

- Print — clean printable layout of exactly what's on screen.
- Download PDF — landscape letter, ECI logo near the top center, TimeX heading, period and filters shown, charts included when the overview is part of the report, then the table with totals. Same branding as the payroll PDF.
- Download CSV — the same rows and chosen columns as raw data.

File names include the report type and date range.

## Navigation

Reports gets its own top-nav item and a home page tile, between PTO & Holiday and Payroll.

## Technical notes

- New route `src/routes/reports.tsx`, with report logic in a shared `src/lib/reporting.ts` built on the existing helpers in `src/lib/timekeeping.ts`.
- Charts use recharts (already installed). PDF uses the same jsPDF/autotable approach as `src/routes/payroll.tsx`; charts are rasterized from the rendered SVG into the PDF.
- `weekStart`/`weekEnd`/`weekDays` in `src/lib/timekeeping.ts` change to Sunday-start, 7 days; `src/routes/payroll.tsx`, `src/routes/time-entries.tsx`, and `src/components/TimeCardPanel.tsx` update to the 7-day week.
- Builder selections live in URL search params so a report link can be shared or bookmarked.
- No database changes; reads existing `time_entries`, `employees`, `jobs`, `divisions` with the current realtime subscriptions.
