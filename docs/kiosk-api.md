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
  "divisions": [{ "id": "uuid", "name": "Commercial", "code": "COM" }],
  "jobs": [{ "id": "uuid", "number": "2401", "name": "...", "location": "...", "active": true }],
  "employees": [{ "id": "uuid", "first_name": "...", "last_name": "...", "division_id": "uuid", "assigned_job_id": "uuid" }]
}
```

Call on app launch and on reconnect. Cache locally; select an employee →
default their `assigned_job_id`, but allow choosing any job in `jobs`.

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

## POST `/api/public/kiosk/verify-pin`

```json
{ "pin": "8141" }  →  { "ok": true }
```

Gate for the supervisor Adjustments screen. The code itself never leaves the
server; the app only ever sends a candidate and reads `ok`.

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
