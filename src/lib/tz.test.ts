import { test } from "node:test";
import assert from "node:assert/strict";
import { DEFAULT_TIMEZONE, dateKeyInZone, isValidTimeZone } from "./tz.ts";

test("an evening punch stays on the same Eastern day even though UTC has rolled over", () => {
  // 7:30 pm EDT on Sep 16 is 23:30 UTC on Sep 16
  assert.equal(dateKeyInZone("2026-09-16T23:30:00.000Z", "America/New_York"), "2026-09-16");
  // 11:59 pm EDT on Sep 16 is 03:59 UTC on Sep 17 — the bug this guards against
  assert.equal(dateKeyInZone("2026-09-17T03:59:00.000Z", "America/New_York"), "2026-09-16");
  // midnight Eastern flips the day
  assert.equal(dateKeyInZone("2026-09-17T04:00:00.000Z", "America/New_York"), "2026-09-17");
});

test("standard time (winter) uses the five-hour offset", () => {
  // 11:30 pm EST on Jan 14 is 04:30 UTC on Jan 15
  assert.equal(dateKeyInZone("2026-01-15T04:30:00.000Z", "America/New_York"), "2026-01-14");
  assert.equal(dateKeyInZone("2026-01-15T05:00:00.000Z", "America/New_York"), "2026-01-15");
});

test("offsets in the input are honoured", () => {
  assert.equal(dateKeyInZone("2026-09-16T19:30:00-04:00", "America/New_York"), "2026-09-16");
  assert.equal(dateKeyInZone("2026-09-16T22:30:00-07:00", "America/New_York"), "2026-09-17");
});

test("an unknown zone falls back to the company default instead of throwing", () => {
  assert.equal(isValidTimeZone("Mars/Olympus"), false);
  assert.equal(
    dateKeyInZone("2026-09-17T03:59:00.000Z", "Mars/Olympus"),
    dateKeyInZone("2026-09-17T03:59:00.000Z", DEFAULT_TIMEZONE),
  );
});

test("an invalid timestamp throws", () => {
  assert.throws(() => dateKeyInZone("not a date"));
});
