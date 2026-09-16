# Hardening pass — 2026-09-16

This change closes the findings marked critical and high in the 2026-09-16
review of TimeX, in the order the review suggested. Nothing in the office UI
changes for signed-in users; the kiosk looks the same but works differently
underneath.

## What changed

### 1. The database is no longer writable without a login

Before: the anonymous role had full read, insert, update and delete on
`employees`, `jobs`, `divisions` and `time_entries`, and the browser used that
role directly from `/kiosk` and `/adjustments`. Anyone with the URL could
rewrite payroll from devtools.

Now: `supabase/migrations/20260917000000_lock_down_anon_and_kiosk.sql` drops the
four `*_kiosk` policies and revokes every anon grant. The kiosk and adjustments
screens call server functions in `src/lib/kiosk.functions.ts`, which run on the
server with the service role through `src/lib/kiosk-api.server.ts`, the same
module the mobile API already used. The browser bundle no longer contains any
code path that touches those tables anonymously.

### 2. Supervisor code: server-enforced, rate-limited

Before: the code was checked once, the browser set a flag, and every edit that
followed was an ordinary anonymous write. Nothing stopped brute force.

Now: `verifyKioskPin` returns a signed 15-minute token (HMAC-SHA256) and every
adjustment read or write must present it. Five wrong codes from one address,
or fifty from anywhere, in fifteen minutes lock the code for fifteen minutes
(`auth_throttle` table). `changeKioskPin` requires a signed-in administrator.
The hard-coded `8141` fallback is gone; the code lives only in `app_settings`.
The code stays 4 digits by decision; the throttle limits guessing to roughly
20 tries an hour per address.

### 3. Punch photos require a login

`getPunchPhotoUrl` now requires a signed-in user and reads the entry through
that user's own client, so row level security decides whether they may see the
employee. `savePunchPhoto` is removed: the photo travels inside the punch call
and is stored on the server as part of it. The 30-day purge moved from "every
time someone opens Time Entries" to a cron route, `/api/cron/purge-photos`,
protected by the Lovable cron secret.

### 4. Payroll queries no longer stop at 1,000 rows

PostgREST returns at most 1,000 rows per request and does not say when it has
truncated. Every list read in `src/lib/timekeeping.ts` now pages with
`.range()` until a short page comes back, ordered by `id` last so pages never
overlap. With 209 workers a week is well over 2,000 rows.

### 5. The backup kiosk works offline

`public/sw.js` caches the `/kiosk` and `/adjustments` shells (network first,
cache fallback) and caches scripts, styles, fonts and images as they load.
`public/manifest.webmanifest` and the icons in `public/icons/` make it
installable. The kiosk also keeps the last crew and job lists in local storage
so it can start with no signal. The office portal, server functions and API
routes are never intercepted.

### 6. Offline clock-in then clock-out

`resolveClockedIn` in `src/lib/kiosk-state.ts` merges punches still queued on
the device with the server's open list, so after an offline clock-in the Clock
Out button is enabled and a second Clock In is not.

### 7. Rejected punches leave the queue

The offline queue follows the mobile API contract: network failure or
`retry: true` keeps the punch (and everything after it, in order); `ok` or
`duplicate` drops it; a business rejection drops it and shows a banner on the
kiosk naming the worker and the reason. Queue entries written by the previous
kiosk version are upgraded on read.

### 8. Work dates in the company timezone

`src/lib/tz.ts` computes `work_date` in `app_settings.timezone`
(`America/New_York`). Lovable Cloud runs on Cloudflare in UTC, so before this a
punch after 8 pm Eastern from the mobile app landed on the next day. Both
kiosks and manual adjustments now agree. Covered by `src/lib/tz.test.ts`.

### 9. One open punch per employee

A unique partial index on `time_entries (employee_id) where clock_out is null
and entry_type = 'work'` stops two kiosks from opening two punches for the
same person. The loser gets `retry: true`, resends, and it becomes a job
switch. The migration first closes any duplicates that already exist (0 hours,
with a note) so the index can be created.

Also in this pass: punches for an inactive employee or a closed job are
rejected with a message; adjustments validate clock-out after clock-in and a
span under 24 hours; the kiosk hides closed jobs; the kiosk shows a one-line
notice that a photo is taken.

## Manual steps after merging

1. **Apply the migration.** Lovable runs the migrations it writes itself; a
   file added from GitHub may not be picked up automatically. Check the
   Lovable Cloud database view after merging, and if `auth_throttle` does not
   exist, paste `20260917000000_lock_down_anon_and_kiosk.sql` into the SQL
   editor and run it once. Every statement is guarded; re-running is a no-op.
   Until it runs, the kiosk already works through the new server path, but
   the anonymous grants stay open.
2. **Set the supervisor code** in Admin → Kiosk Code if it is still the seeded
   value. The code now lives only in the database.
3. **Optional secret:** add `ADJUSTMENT_TOKEN_SECRET` (any long random string)
   in Lovable Cloud. Without it, tokens are signed with `KIOSK_DEVICE_KEY`,
   which works but means rotating the device key also invalidates open
   supervisor sessions.
4. **Schedule the purge.** Add a daily Lovable cron that calls
   `GET /api/cron/purge-photos` with `Authorization: Bearer <LOVABLE_CRON_SECRET>`.
5. **Backup devices:** open `/kiosk` once online on each tablet or phone that
   serves as the emergency kiosk, and add it to the home screen.
6. **Mobile app:** no breaking change. `bootstrap` gained `timezone` and
   `open_entries`; `verify-pin` gained `token`, `locked`, `retryAfterSeconds`
   and returns 429 while locked. See `docs/kiosk-api.md`.

## How this was verified

- `npm run typecheck`, `npm run test` and `npm run build` pass. Tests cover the
  timezone date math (including the evening-UTC case and standard time) and the
  offline clocked-in resolution.
- The live Supabase project was not reachable from the environment this was
  written in, so the migration and the end-to-end punch flow were reviewed but
  not executed against your data. Test on the preview before production:
  punch in and out from `/kiosk`; unlock Adjustments with the code, then with
  five wrong codes; open Time Entries and click a photo; turn off Wi-Fi on a
  tablet and confirm `/kiosk` opens and a clock-in then clock-out queue and send.

## Residual risks, deliberately left

- **The web kiosk is public by design.** Anyone who can reach the URL can punch
  for any active employee, because foremen must be able to open it from any
  phone with no setup. The photo is the deterrent. A per-employee code or badge
  number (review item 14) would close this.
- **Kiosk queue in localStorage.** Safari can evict it for sites not visited in
  seven days unless the kiosk is installed to the home screen. IndexedDB would
  be more durable (review item 7, second part).
- **No audit trail, hard deletes, no closed pay periods** (review items 11 to 13) were out of scope for this pass.
- **Rate limiting is per Cloudflare-reported address.** A crew behind one NAT
  shares a limit of five wrong codes per fifteen minutes, which is intended.
