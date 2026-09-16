/**
 * Pure helpers for the kiosk screen. No I/O, so they run under node --test.
 */

import type { KioskPunchInput } from "./kiosk-types";

type OpenLike = { employee_id: string };
type QueuedLike = Pick<KioskPunchInput, "employee_id" | "action">;

/**
 * Whether an employee is clocked in, taking punches that are still waiting on
 * the device into account. The server's list is only right once the queue has
 * drained; the most recent queued punch for the employee wins over it.
 */
export function resolveClockedIn(
  serverOpen: ReadonlyArray<OpenLike>,
  queued: ReadonlyArray<QueuedLike>,
  employeeId: string,
): boolean {
  if (!employeeId) return false;
  const lastQueued = [...queued].reverse().find((q) => q.employee_id === employeeId);
  if (lastQueued) return lastQueued.action === "in";
  return serverOpen.some((e) => e.employee_id === employeeId);
}

/**
 * Upgrades a punch stored by an earlier version of the kiosk (which used
 * `client_punch_id` / `queued_id`) to the current shape. Returns null when the
 * stored value is not a punch at all.
 */
export function normalizeQueuedPunch(raw: unknown): KioskPunchInput | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  const punchId = [r["punch_id"], r["client_punch_id"], r["queued_id"]].find(
    (v): v is string => typeof v === "string" && v.length >= 8,
  );
  const action = r["action"];
  if (
    !punchId ||
    typeof r["employee_id"] !== "string" ||
    typeof r["job_id"] !== "string" ||
    typeof r["at"] !== "string" ||
    (action !== "in" && action !== "out")
  ) {
    return null;
  }
  return {
    punch_id: punchId,
    employee_id: r["employee_id"],
    job_id: r["job_id"],
    action,
    at: r["at"],
    job_overridden: r["job_overridden"] === true,
    photo: typeof r["photo"] === "string" ? r["photo"] : null,
  };
}
