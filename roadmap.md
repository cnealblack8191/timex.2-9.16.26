# ECI Timekeeping — roadmap

- [x] Design direction (frosted panel) + theme tokens
- [x] Database: divisions, jobs, employees, time entries + sample data
- [x] Jobsite kiosk punch screen (name → job → in/out, confirmation)
- [x] Offline punch queue on the device, auto-sends on reconnect
- [x] Foreman override to pick any job at the kiosk
- [x] Live updates in the management portal
- [x] Operations dashboard: who's clocked in, recent time, bulk assign
- [x] Time entries: filter by day/week/employee/job/division, edit & delete
- [x] Assignments: individual and bulk by division
- [x] PTO & vacation pay for one or many employees
- [x] Weekly hours review with 40-hour overtime flags
- [x] Payroll CSV and PDF downloads
- [x] Add separate PTO and Vacation columns to the payroll report
- [x] Ensure an employee selection immediately populates their assigned job
- [x] Code-protected Adjustments screen on the kiosk (edit times/job, add missing punches, reason required)
- [x] Change the kiosk adjustment code from the dashboard
- [x] Kiosk API for the native iOS/Android app (bootstrap, punch, status, code check)
- [x] Duplicate-proof punch sync (device punch id) for both the app and the web kiosk

Architecture: the dashboard (/) is office-only. The field kiosk exists twice:
as the web screen at /kiosk (still fully supported, online and offline) and as
a documented HTTP API at /api/public/kiosk/* that ECI's existing iOS/Android
app calls natively. Both write to the same database, so the office dashboard
updates in real time via realtime. Device calls are authorised with the
KIOSK_DEVICE_KEY secret in the x-kiosk-key header. API contract: docs/kiosk-api.md.

Open: no manager login yet — the portal is open to anyone with the link.
Employee data is sample data until the existing ECI system is connected.
