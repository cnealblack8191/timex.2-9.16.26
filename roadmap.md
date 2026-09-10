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

Architecture: the dashboard (/) is office-only; the kiosk (/kiosk + /adjustments)
is a self-contained mobile surface meant to be embedded in ECI's existing
iOS/Android app via a WebView. Kiosk has no dependency on portal UI, works
offline (punches queue on-device in localStorage and auto-sync on reconnect),
and portal data updates live via realtime.

Open: no manager login yet — the portal is open to anyone with the link.
Employee data is sample data until the existing ECI system is connected.
