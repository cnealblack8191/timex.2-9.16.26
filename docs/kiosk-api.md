# TimeX Kiosk API (for the native iOS / Android app)

Base URL (preview): `https://project--a108b7fa-b28b-49a2-979c-c473aa80866d-dev.lovable.app`
Base URL (production): `https://project--a108b7fa-b28b-49a2-979c-c473aa80866d.lovable.app`

Every request must send the device key header:

```
x-kiosk-key: <KIOSK_DEVICE_KEY>
```

The key is stored as a backend secret. Ship it inside the mobile app's secure
storage / build config — never in client-side JavaScript.

All responses are JSON and never cached.

---

## GET `/api/public/kiosk/bootstrap`

Everything the device caches so it can run with no signal.

```json
{
  "synced_at": "2026-09-10T03:00:00.000Z",
  "timezone": "America/New_York",
  "divisions": [{ "id": "uuid", "name": "Field Team", "code": "FIELD" }],
  "jobs": [{ "id": "uuid", "number": "2401", "name": "...", "location": "...", "active": true }],
  "employees": [{ "id": "uuid", "first_name": "...", "last_name": "...", "division_id": "uuid", "assigned_job_id": "uuid" }],
  "open_entries": [{ "id": "uuid", "employee_id": "uuid", "job_id": "uuid", "clock_in": "...", "work_date": "2026-09-10" }]
}
```

Call on app launch and on reconnect. Cache locally; select an employee →
default their `assigned_job_id`, but allow choosing any job in `jobs`.

`open_entries` lists everyone currently clocked in, so the device can show
Clock In vs Clock Out for any employee without a `status` call per person.
`timezone` is the company zone the server files every punch under (see
"Work dates" below).

## GET `/api/public/kiosk/status?employee_id=<uuid>`

```json
{ "employee_id": "uuid", "clocked_in": true,
  "open_entry": { "id": "uuid", "job_id": "uuid", "clock_in": "...", "work_date": "2026-09-10" } }
```

Use it to show Clock In vs Clock Out. When offline, decide from the local cache.

## POST `/api/public/kiosk/punch`

Send one punch or a whole offline queue in a single call.

```json
{
  "punches": [
    {
      "punch_id": "device-generated-uuid",
      "employee_id": "uuid",
      "job_id": "uuid",
      "action": "in",
      "at": "2026-09-10T12:04:11.000Z",
      "job_overridden": false,
      "source": "ios",
      "photo": "data:image/jpeg;base64,..."
    }
  ]
}
```

`photo` is optional. Capture a front-camera still at the moment of the punch,
downscale to ~480px wide, encode JPEG at ~45% quality (target < 60 KB), and send
it with the punch — including queued offline punches. A punch is never rejected
because the photo is missing or the camera is blocked. Photos are stored in a
private bucket, are never shown automatically in the office portal, and are
deleted automatically after 30 days.

Response:

```json
{ "results": [ { "punch_id": "...", "ok": true, "duplicate": false, "message": "Clocked in" } ] }
```

Rules for the mobile client:

- Generate `punch_id` once, when the worker taps the button, and reuse it on
  every retry. The server ignores a `punch_id` it has already stored, so
  resending is always safe.
- `at` is the real punch time in ISO 8601 with offset — not the sync time.
- Delete a queued punch when `ok: true` **or** `duplicate: true`.
- Keep it queued when `retry: true` or the request fails at the network level.
- `ok: false` without `retry` is a business rejection (e.g. clocking out with no
  open punch): drop it and show the message.
- A clock-in while another punch is open closes the previous one automatically
  (job switch).
- Two devices opening a punch for the same person at the same moment: the
  database allows only one open punch per employee, so the second one comes
  back `ok: false, retry: true`. Resend it and it becomes a normal job switch.
- Punches for an inactive employee or a closed job are rejected (`ok: false`,
  no `retry`) with a message to show the worker.

### Closed payroll weeks

Once the office closes a payroll week, a punch or clock-out that lands in it
is **still accepted and recorded** (a queued offline punch must never be lost)
but the database marks it `after_close`, and the office sees it flagged on
Operations and Payroll. Nothing changes for the device. The supervisor
Adjustments screen, however, refuses to change a closed week with the message
"The office has closed that payroll week."

### Work dates

The server computes `work_date` from `at` in the company timezone stored in
`app_settings.timezone` (currently `America/New_York`), never in UTC. A punch at
7:30 pm Eastern is filed under that day even though it is already tomorrow in
UTC. The device does not need to send a date.

## POST `/api/public/kiosk/verify-pin`

```json
{ "pin": "1234" }  →  { "ok": true, "token": "…" }
{ "pin": "0000" }  →  { "ok": false, "locked": false, "retryAfterSeconds": 0 }
```

Gate for the supervisor Adjustments screen. The code itself never leaves the
server; the app only ever sends a candidate and reads `ok`.

Five wrong codes from one address, or fifty from anywhere, in fifteen minutes
lock the code for fifteen minutes. While locked the response is HTTP 429 with
`locked: true` and `retryAfterSeconds`; show the wait instead of retrying.

A correct code returns a signed `token` valid for 15 minutes. Send it with any
future adjustment call; when it expires, ask for the code again.

---

## Live behaviour

Punches land directly in the shared database, so the office dashboard updates
in real time (Realtime is on for `time_entries` and `employees`) with no extra
work from the mobile app.

## Web kiosk — required emergency backup

`/kiosk` stays available and fully functional online and offline. It is not
only a development convenience: **ECI requires a working browser kiosk as the
emergency backup** for the native screen.

Hand-off requirements:

- Keep the web kiosk deployed and reachable at all times at
  `https://timex-eci.lovable.app/kiosk` (preview: the `-dev` host). Do not
  remove or gate it behind the native app.
- Foremen should have the URL saved/bookmarked (add-to-home-screen works) so
  crews can punch from any phone, tablet, or laptop if the native app fails,
  will not update, loses its device key, or is pulled from the store.
- **Open the kiosk once while online on each backup device.** That visit
  installs the service worker and caches the crew and job lists, so the page
  opens and punches with no signal from then on. Install it to the home
  screen on iPhone and iPad: Safari evicts the offline cache of ordinary
  bookmarks after seven days without a visit, but not of installed apps.
- After each release, open the backup kiosk online once so it picks up the new
  build; until then it keeps working on the previous one.
- The web kiosk writes to the same database with the same duplicate-proof
  `client_punch_id`, so punches made in the backup and in the native app can
  never double-count each other.
- It queues punches locally when there is no signal and sends them on
  reconnect, exactly like the native queue.
- The supervisor Adjustments screen is reachable from the backup kiosk with the
  same code, so a foreman can correct a bad punch without the office.
- The layout is responsive and works in both portrait and landscape.
- Include the backup URL and a one-line "what to do if the app is down" note in
  the native app's help/support screen.
- Verify the backup path as part of every release test: open the URL on a
  device with the native app uninstalled, punch in, punch out, confirm the
  entries appear on the office dashboard.
