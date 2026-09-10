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
      "source": "ios"
    }
  ]
}
```

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

## Web kiosk

`/kiosk` stays available and fully functional online and offline — useful for
tablets, testing, and as a fallback while the native screen is built.
