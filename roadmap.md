# ECI Timekeeping — roadmap

- [x] Design direction (frosted panel) + theme tokens
- [x] Database: divisions, jobs, employees, time entries + sample data
- [x] Jobsite kiosk punch screen (name → job → in/out, confirmation)
- [x] Offline punch queue on the device, auto-sends on reconnect
- [x] Foreman override to pick any job at the kiosk
- [x] Live updates in the management portal
- [x] Operations dashboard: who's clocked in, recent time, bulk assign
- [x] Time entries: filter by day/week/employee/job/division, edit & delete
- [x] Assignments: individual and bulk by division (now under Admin → Bulk Assign)
- [x] PTO & vacation pay for one or many employees
- [x] Weekly hours review with 40-hour overtime flags
- [x] Payroll CSV and PDF downloads
- [x] Add separate PTO and Vacation columns to the payroll report
- [x] Ensure an employee selection immediately populates their assigned job
- [x] Code-protected Adjustments screen on the kiosk (edit times/job, add missing punches, reason required)
- [x] Change the kiosk adjustment code from the dashboard
- [x] Kiosk API for the native iOS/Android app (bootstrap, punch, status, code check)
- [x] Duplicate-proof punch sync (device punch id) for both the app and the web kiosk
- [x] Admin section: add/edit divisions, jobs, employees
- [x] Admin section: change kiosk supervisor adjustment code
- [x] Move kiosk code control from Operations dashboard to Admin section
- [x] Remove kiosk preview card from Operations dashboard
- [x] Web kiosk works in portrait and landscape (device rotation)
- [x] Developer hand-off: document the web kiosk as the emergency backup kiosk
- [x] Time Entries: employee name search bar


Architecture: the dashboard (/) is office-only. The field kiosk exists twice:
as the web screen at /kiosk (still fully supported, online and offline) and as
a documented HTTP API at /api/public/kiosk/* that ECI's existing iOS/Android
app calls natively. Both write to the same database, so the office dashboard
updates in real time via realtime. Device calls are authorised with the
KIOSK_DEVICE_KEY secret in the x-kiosk-key header. API contract: docs/kiosk-api.md.

Open:
- No manager login yet — the portal is open to anyone with the link.
- Employee data is sample data until the existing ECI system is connected.
- Punch photos currently live in Supabase storage; moving them to AWS S3 is pending your go-ahead.

## Logins & permissions (done)
- [x] Office sign-in required; kiosk stays open
- [x] Roles: Admin, Payroll (all divisions, edit only granted groups/people), View only
- [x] Admin → Users tab: create with temp password, set role + divisions, deactivate
- [x] Division scoping across the office pages (enforced in the database)
- [x] Admin account charles@ecinc.us

## Hardening (2026-09-16) — see docs/HARDENING_2026-09-16.md
- [x] Anonymous database access removed; web kiosk and adjustments run through server functions
- [x] Supervisor code rate-limited, unlock issues a 15-minute token, code change is admin-only
- [x] Punch photo lookup requires a login; purge moved to a cron route
- [x] Office queries page past PostgREST's 1,000-row cap
- [x] Backup web kiosk installable and opens offline (service worker + manifest)
- [x] Offline clock-in then clock-out on the same device
- [x] Rejected punches leave the offline queue and are shown on the kiosk
- [x] Work dates computed in the company timezone (America/New_York)
- [x] One open punch per employee enforced by the database
- [ ] Per-employee kiosk code or badge number (buddy punching)
- [x] Change history on every time entry (docs/PAYROLL_INTEGRITY_2026-09-16.md)
- [x] Entries are voided with a reason, never deleted; administrators can restore
- [x] Every office correction requires a reason and appends to the notes
- [x] Close payroll week (payroll or admin), reopen (admin only), late kiosk punches flagged
- [x] Open punches flagged "Needs clock-out" after 14 hours, never auto-closed
- [ ] Employee identifier for the worker import — to be agreed with the existing ECI system
