# ECI Timekeeper

ask me questions you want clarity on before building this if it will help refine the first pass, Absolutely. Paste this into Lovable as the first simple build prompt:

Build an ECI Employee Timekeeping System

Create a simple timekeeping application for Electrical Contractor Inc. (ECI). It will have two interfaces: an iPad kiosk for employees and a web-based management portal.

Employee iPad Kiosk

Keep the screen extremely simple and easy to use on a jobsite.

Employee selects their Job from a dropdown.

Employee selects their Name from a dropdown.

Employee chooses Clock In or Clock Out.

Record the employee, job, date, and exact time.

Display a clear confirmation after the punch.

No username or password should be required for employees at the kiosk.

Web Management Portal

The management website should focus only on time and job assignments. Do not build a full employee-management system.

Managers should be able to:

View employee time by day, week, employee, and job.

Correct or edit time entries.

See who is currently clocked in.

Assign individual employees to jobs.

Bulk assign employees to jobs, including selecting employees based on their existing company division/group.

Enter PTO for an individual employee or multiple employees at once.

Enter Vacation Pay for an individual employee or multiple employees at once.

Review weekly employee hours.

Export timekeeping data for payroll.

Employee Data

ECI already has an existing application containing employee information, including each employee's company division/group. That existing application will eventually be the source of truth for employee information.

For the first version, create sample employee, division, and job data so we can build and test the workflow before connecting the existing ECI application.

Design

Make the application clean, modern, professional, and very simple. The iPad kiosk should use large controls designed for quick use by construction employees. The management website should be optimized for desktop use.

Important: Start with this core functionality. Do not add unnecessary HR, scheduling, payroll, GPS, facial recognition, or other features yet. Build the basic working time-clock workflow first.

This project was built with [Lovable](https://lovable.dev).

**Live app**: https://timex-eci.lovable.app

## Security model (after the 2026-09-16 hardening)

- The browser never reads or writes timekeeping tables without a login. Office
  pages use the signed-in user's Supabase session and row level security.
- The web kiosk (`/kiosk`) and the supervisor Adjustments screen call server
  functions that run with the service role, the same path the mobile API uses.
  Adjustments also need a 15-minute token issued after a correct, rate-limited
  supervisor code.
- Work dates are computed on the server in the company timezone
  (`app_settings.timezone`), and the database allows one open punch per employee.
- Punch photos are served only to signed-in users allowed to see that employee,
  and purged after 30 days by `/api/cron/purge-photos` (schedule it daily).

Backend secrets (Lovable Cloud): `KIOSK_DEVICE_KEY` for the mobile API,
optional `ADJUSTMENT_TOKEN_SECRET` for supervisor tokens (falls back to the
device key), and `LOVABLE_CRON_SECRET` for the purge route.

Details, manual steps and residual risks: [docs/HARDENING_2026-09-16.md](docs/HARDENING_2026-09-16.md).
Kiosk API contract: [docs/kiosk-api.md](docs/kiosk-api.md).

## Checks

```sh
npm run typecheck   # tsc
npm run test        # node --test, no extra dependencies
npm run build       # production build
npm run check       # all three
```

## Build with Lovable

Continue developing this project in the [Lovable editor](https://lovable.dev/projects/a108b7fa-b28b-49a2-979c-c473aa80866d).

- **Ship faster**: describe what you want to build and Lovable handles the code.
- **Stay in sync**: every change made in Lovable is committed straight to this repository.
- **Full ownership**: this code is yours. Push to `main` on GitHub and your changes sync back into Lovable, ready for your next prompt.

## Development

Prefer working locally? You need Node.js and npm — [install with nvm](https://github.com/nvm-sh/nvm#installing-and-updating).

```sh
git clone <this-repository-url>
cd <repository-name>
npm i
npm run dev
```
