import { test } from "node:test";
import assert from "node:assert/strict";
import { normalizeQueuedPunch, resolveClockedIn } from "./kiosk-state.ts";

const alice = "11111111-1111-4111-8111-111111111111";
const bob = "22222222-2222-4222-8222-222222222222";

test("falls back to the server when nothing is queued for the employee", () => {
  assert.equal(resolveClockedIn([{ employee_id: alice }], [], alice), true);
  assert.equal(resolveClockedIn([{ employee_id: alice }], [], bob), false);
  assert.equal(resolveClockedIn([], [], alice), false);
});

test("a queued clock-in makes the employee clocked in even though the server has no open punch", () => {
  const queued = [{ employee_id: alice, action: "in" as const }];
  assert.equal(resolveClockedIn([], queued, alice), true);
});

test("a queued clock-out overrides an open punch on the server", () => {
  const queued = [{ employee_id: alice, action: "out" as const }];
  assert.equal(resolveClockedIn([{ employee_id: alice }], queued, alice), false);
});

test("the most recent queued punch for the employee wins", () => {
  const queued = [
    { employee_id: alice, action: "in" as const },
    { employee_id: bob, action: "in" as const },
    { employee_id: alice, action: "out" as const },
  ];
  assert.equal(resolveClockedIn([], queued, alice), false);
  assert.equal(resolveClockedIn([], queued, bob), true);
});

test("an empty employee id is never clocked in", () => {
  assert.equal(resolveClockedIn([{ employee_id: "" }], [], ""), false);
});

test("punches stored by the previous kiosk version are upgraded", () => {
  const legacy = {
    employee_id: alice,
    job_id: bob,
    action: "in",
    at: "2026-09-16T11:00:00.000Z",
    job_overridden: false,
    client_punch_id: "abcdefgh-1234",
    queued_id: "abcdefgh-1234",
    employee_name: "Alice",
    job_label: "#1",
    photo: null,
  };
  assert.deepEqual(normalizeQueuedPunch(legacy), {
    punch_id: "abcdefgh-1234",
    employee_id: alice,
    job_id: bob,
    action: "in",
    at: "2026-09-16T11:00:00.000Z",
    job_overridden: false,
    photo: null,
  });
});

test("garbage in storage is dropped rather than sent", () => {
  assert.equal(normalizeQueuedPunch(null), null);
  assert.equal(normalizeQueuedPunch("nope"), null);
  assert.equal(normalizeQueuedPunch({ employee_id: alice }), null);
  assert.equal(
    normalizeQueuedPunch({
      punch_id: "abcdefgh",
      employee_id: alice,
      job_id: bob,
      at: "x",
      action: "sideways",
    }),
    null,
  );
});
