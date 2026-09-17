/**
 * Punches taken with no signal wait here and are sent, oldest first, when the
 * kiosk is back online. Follows the same rules the mobile app is documented to:
 *
 * - network failure or `retry: true`  → keep it and stop; later punches must not
 *   overtake it
 * - `ok: true` or `duplicate: true`  → done, remove it
 * - `ok: false` without `retry`      → a business rejection (e.g. clocking out
 *   with no open punch): remove it and show the message
 */

import { kioskPunch } from "./kiosk.functions";
import { normalizeQueuedPunch } from "./kiosk-state";
import type { KioskPunchInput } from "./kiosk-types";

const QUEUE_KEY = "eci-pending-punches";
const REJECTED_KEY = "eci-rejected-punches";
const MAX_REJECTED = 20;
export const QUEUE_EVENT = "eci-queue-changed";

export type QueuedPunch = KioskPunchInput & {
  employee_name: string;
  job_label: string;
  queued_at: string;
};

export type RejectedPunch = { punch: QueuedPunch; message: string; at: string };

function readJson<T>(key: string): T[] {
  if (typeof window === "undefined") return [];
  try {
    const parsed = JSON.parse(window.localStorage.getItem(key) ?? "[]") as unknown;
    return Array.isArray(parsed) ? (parsed as T[]) : [];
  } catch {
    return [];
  }
}

function writeJson(key: string, items: unknown[]) {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(key, JSON.stringify(items));
  window.dispatchEvent(new Event(QUEUE_EVENT));
}

/** Stored punches, upgraded from older kiosk versions and stripped of anything unreadable. */
export function getQueue(): QueuedPunch[] {
  return readJson<Record<string, unknown>>(QUEUE_KEY).flatMap((raw) => {
    const punch = normalizeQueuedPunch(raw);
    if (!punch) return [];
    return [
      {
        ...punch,
        employee_name: typeof raw["employee_name"] === "string" ? raw["employee_name"] : "",
        job_label: typeof raw["job_label"] === "string" ? raw["job_label"] : "",
        queued_at: typeof raw["queued_at"] === "string" ? raw["queued_at"] : punch.at,
      },
    ];
  });
}

export function enqueue(punch: QueuedPunch) {
  writeJson(QUEUE_KEY, [...getQueue(), punch]);
}

export function getRejected(): RejectedPunch[] {
  return readJson<RejectedPunch>(REJECTED_KEY);
}

export function clearRejected() {
  writeJson(REJECTED_KEY, []);
}

export type FlushOutcome = { sent: number; remaining: number; rejected: number };

let flushing: Promise<FlushOutcome> | null = null;

/** Sends every stored punch in order. Never runs twice at once. */
export function flushQueue(): Promise<FlushOutcome> {
  if (!flushing) {
    flushing = doFlush().finally(() => {
      flushing = null;
    });
  }
  return flushing;
}

async function doFlush(): Promise<FlushOutcome> {
  const items = getQueue();
  if (items.length === 0) return { sent: 0, remaining: 0, rejected: 0 };

  const remaining: QueuedPunch[] = [];
  const rejected: RejectedPunch[] = [];
  let sent = 0;

  for (let i = 0; i < items.length; i += 1) {
    const item = items[i];
    if (!item) continue;
    let result;
    try {
      result = await kioskPunch({
        data: {
          punch_id: item.punch_id,
          employee_id: item.employee_id,
          job_id: item.job_id,
          action: item.action,
          at: item.at,
          job_overridden: item.job_overridden,
          photo: item.photo ?? null,
        },
      });
    } catch {
      // No connection or the server is down: keep this and everything after it, in order.
      remaining.push(...items.slice(i));
      break;
    }
    if (result.ok) {
      sent += 1;
    } else if (result.retry) {
      remaining.push(...items.slice(i));
      break;
    } else {
      rejected.push({
        punch: { ...item, photo: null },
        message: result.message,
        at: new Date().toISOString(),
      });
    }
  }

  writeJson(QUEUE_KEY, remaining);
  if (rejected.length > 0) {
    writeJson(REJECTED_KEY, [...getRejected(), ...rejected].slice(-MAX_REJECTED));
  }
  return { sent, remaining: remaining.length, rejected: rejected.length };
}
