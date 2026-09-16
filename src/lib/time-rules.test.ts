import { test } from "node:test";
import assert from "node:assert/strict";
import {
  STALE_PUNCH_HOURS,
  actorLabel,
  appendNote,
  changedFields,
  isStalePunch,
  weekStartKey,
} from "./time-rules.ts";

const hours = (n: number) => n * 3_600_000;
const now = Date.parse("2026-09-16T22:00:00.000Z");

test("a punch open longer than the threshold needs a clock-out", () => {
  const openSince = new Date(now - hours(STALE_PUNCH_HOURS + 1)).toISOString();
  assert.equal(
    isStalePunch({ entry_type: "work", clock_in: openSince, clock_out: null }, now),
    true,
  );
});

test("a punch open for a normal shift is not flagged", () => {
  const openSince = new Date(now - hours(9)).toISOString();
  assert.equal(
    isStalePunch({ entry_type: "work", clock_in: openSince, clock_out: null }, now),
    false,
  );
});

test("closed, voided, PTO and empty entries are never flagged", () => {
  const old = new Date(now - hours(40)).toISOString();
  assert.equal(isStalePunch({ entry_type: "work", clock_in: old, clock_out: old }, now), false);
  assert.equal(
    isStalePunch({ entry_type: "work", clock_in: old, clock_out: null, voided: true }, now),
    false,
  );
  assert.equal(isStalePunch({ entry_type: "pto", clock_in: null, clock_out: null }, now), false);
  assert.equal(isStalePunch({ entry_type: "work", clock_in: null, clock_out: null }, now), false);
});

test("payroll weeks start on Sunday", () => {
  assert.equal(weekStartKey("2026-09-16"), "2026-09-13"); // a Wednesday
  assert.equal(weekStartKey("2026-09-13"), "2026-09-13"); // Sunday maps to itself
  assert.equal(weekStartKey("2026-09-19"), "2026-09-13"); // Saturday, same week
  assert.equal(weekStartKey("2026-09-20"), "2026-09-20"); // next Sunday, next week
  assert.equal(weekStartKey("2026-01-01"), "2025-12-28"); // crosses a year boundary
});

test("notes are appended, never replaced", () => {
  assert.equal(appendNote(null, "first"), "first");
  assert.equal(appendNote("", "first"), "first");
  assert.equal(appendNote("first", "second"), "first\nsecond");
  assert.equal(appendNote("first\n", " second "), "first\nsecond");
});

test("only tracked fields that actually differ are reported", () => {
  const before = {
    id: "x",
    clock_in: "2026-09-16T11:00:00Z",
    clock_out: null,
    job_id: "a",
    manual_hours: null,
    notes: null,
    voided: false,
    clock_in_photo: "p1",
  };
  const after = {
    ...before,
    clock_out: "2026-09-16T19:30:00Z",
    notes: "Forgot to clock out",
    clock_in_photo: "p2",
  };
  const changes = changedFields(before, after);
  assert.deepEqual(
    changes.map((c) => c.field),
    ["clock_out", "notes"],
  );
  assert.equal(changes[0]?.to, "2026-09-16T19:30:00Z");
});

test("numeric hours compare by value, so '8.00' and 8 are not a change", () => {
  assert.deepEqual(changedFields({ manual_hours: "8.00" }, { manual_hours: 8 }), []);
  assert.equal(changedFields({ manual_hours: 8 }, { manual_hours: 7.5 }).length, 1);
});

test("a created entry lists its populated fields, a deleted one its former values", () => {
  const created = changedFields(null, { clock_in: "t", job_id: "j", voided: false });
  assert.deepEqual(
    created.map((c) => c.field),
    ["job_id", "clock_in", "voided"],
  );
  const deleted = changedFields({ clock_in: "t" }, null);
  assert.deepEqual(deleted, [{ field: "clock_in", from: "t", to: undefined }]);
});

test("the actor is the person when known, otherwise the channel", () => {
  assert.equal(
    actorLabel({ changed_by_name: "Charles Black", changed_via: "portal" }),
    "Charles Black",
  );
  assert.equal(actorLabel({ changed_by_name: null, changed_via: "kiosk-web" }), "Web kiosk");
  assert.equal(actorLabel({ changed_by_name: null, changed_via: "ios" }), "Mobile app");
  assert.equal(actorLabel({ changed_by_name: null, changed_via: "server" }), "System");
});
