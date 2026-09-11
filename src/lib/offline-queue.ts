import { applyPunch, type PunchInput } from "./timekeeping";
import { savePunchPhoto } from "./punch-photos.functions";

const KEY = "eci-pending-punches";

export type QueuedPunch = PunchInput & {
  queued_id: string;
  employee_name: string;
  job_label: string;
  /** Compressed snapshot taken when the worker punched, sent once back online. */
  photo?: string | null;
};

function read(): QueuedPunch[] {
  if (typeof window === "undefined") return [];
  try {
    return JSON.parse(window.localStorage.getItem(KEY) ?? "[]") as QueuedPunch[];
  } catch {
    return [];
  }
}

function write(items: QueuedPunch[]) {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(KEY, JSON.stringify(items));
  window.dispatchEvent(new Event("eci-queue-changed"));
}

export function getQueue() {
  return read();
}

export function enqueue(punch: QueuedPunch) {
  write([...read(), punch]);
}

/** Sends every stored punch, oldest first. Keeps anything that still fails. */
export async function flushQueue() {
  const items = read();
  if (items.length === 0) return { sent: 0, remaining: 0 };
  const remaining: QueuedPunch[] = [];
  let sent = 0;
  for (const item of items) {
    try {
      await applyPunch(item);
      sent += 1;
      if (item.photo && item.client_punch_id) {
        try {
          await savePunchPhoto({
            data: { client_punch_id: item.client_punch_id, kind: item.action, data_url: item.photo },
          });
        } catch {
          // the punch itself is safe; a lost photo must not requeue it
        }
      }
    } catch {
      remaining.push(item);
    }
  }
  write(remaining);
  return { sent, remaining: remaining.length };
}
