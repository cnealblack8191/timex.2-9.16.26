# Welcome to your Lovable project

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
- Every change to a time entry is recorded in `time_entry_revisions` by a
  trigger and shown under History. Entries are voided, never deleted; only an
  administrator can restore one. Payroll or an administrator closes a week,
  only an administrator reopens it, and edits inside a closed week are blocked
  by row level security for everyone else. Late kiosk punches are recorded and
  flagged. Details: [docs/PAYROLL_INTEGRITY_2026-09-16.md](docs/PAYROLL_INTEGRITY_2026-09-16.md).

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

Open your project in the [Lovable editor](https://lovable.dev) and keep building.

- **Ship faster**: describe what you want to build and Lovable handles the code.
- **Stay in sync**: connect the project to GitHub and every change made in Lovable is committed straight to your repository.
- **Full ownership**: this code is yours. Push to your repository and your changes sync back into Lovable, ready for your next prompt.

## Development

Prefer working locally? You need Node.js and npm — [install with nvm](https://github.com/nvm-sh/nvm#installing-and-updating).

```sh
git clone <this-repository-url>
cd <repository-name>
npm i
npm run dev
```

## Built with

- TanStack Start
- TypeScript
- React
- Tailwind CSS
