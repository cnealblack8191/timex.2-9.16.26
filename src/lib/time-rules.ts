/**
 * Payroll rules with no I/O, shared by the portal and the server and covered by
 * node --test. Anything here must stay free of browser or Supabase imports.
 */

/** An open punch older than this is shown as "needs clock-out". Nothing is auto-closed. */
export const STALE_PUNCH_HOURS = 14;

type EntryLike = {
  entry_type: string;
  clock_in: string | null;
  clock_out: string | null;
  voided?: boolean;
};

/** True for a live work punch that has been open longer than STALE_PUNCH_HOURS. */
export function isStalePunch(entry: EntryLike, now: number = Date.now()): boolean {
  if (entry.entry_type !== "work" || !entry.clock_in || entry.clock_out || entry.voided) {
    return false;
  }
  const started = new Date(entry.clock_in).getTime();
  return !Number.isNaN(started) && now - started > STALE_PUNCH_HOURS * 3_600_000;
}

/** The Sunday (YYYY-MM-DD) that starts the payroll week containing a date key. Pure string math. */
export function weekStartKey(dateKey: string): string {
  const [y, m, d] = dateKey.split("-").map(Number);
  const date = new Date(Date.UTC(y ?? 1970, (m ?? 1) - 1, d ?? 1));
  date.setUTCDate(date.getUTCDate() - date.getUTCDay());
  return date.toISOString().slice(0, 10);
}

/** Adds a line to an entry's notes without losing what was there. */
export function appendNote(existing: string | null | undefined, line: string): string {
  const trimmed = line.trim();
  if (!existing || !existing.trim()) return trimmed;
  return `${existing.trimEnd()}\n${trimmed}`;
}

/** The note line every office correction writes: what happened, when, by whom, and why. */
export function changeLine(
  verb: "Corrected" | "Voided" | "Restored" | "Time card",
  actor: string,
  reason: string,
  when: Date = new Date(),
): string {
  const stamp = when.toLocaleString("en-US", { dateStyle: "short", timeStyle: "short" });
  return `${verb} ${stamp} by ${actor}: ${reason.trim()}`;
}

/* ---------- change history ---------- */

export const TRACKED_FIELDS = [
  "work_date",
  "entry_type",
  "job_id",
  "clock_in",
  "clock_out",
  "manual_hours",
  "notes",
  "voided",
  "void_reason",
  "after_close",
] as const;

export type TrackedField = (typeof TRACKED_FIELDS)[number];

export type FieldChange = { field: TrackedField; from: unknown; to: unknown };

type Row = Record<string, unknown> | null | undefined;

/** The tracked fields whose value differs between two stored rows. */
export function changedFields(oldRow: Row, newRow: Row): FieldChange[] {
  const changes: FieldChange[] = [];
  for (const field of TRACKED_FIELDS) {
    const from = oldRow ? oldRow[field] : undefined;
    const to = newRow ? newRow[field] : undefined;
    if (!sameValue(from, to)) changes.push({ field, from, to });
  }
  return changes;
}

function sameValue(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (a == null && b == null) return true;
  // numeric columns come back as numbers or numeric strings depending on the driver
  if (typeof a === "number" || typeof b === "number") return Number(a) === Number(b);
  return false;
}

type RevisionLike = { changed_by_name: string | null; changed_via: string };

/** Who made a change, for display. A name when a signed-in person did it, else the channel. */
export function actorLabel(revision: RevisionLike): string {
  if (revision.changed_by_name) return revision.changed_by_name;
  switch (revision.changed_via) {
    case "kiosk-web":
      return "Web kiosk";
    case "kiosk-adjust":
      return "Kiosk adjustments";
    case "mobile":
    case "ios":
    case "android":
      return "Mobile app";
    case "time-card":
      return "Time card";
    case "portal":
      return "Office user";
    default:
      return "System";
  }
}

export function actionLabel(action: string): string {
  switch (action) {
    case "insert":
      return "Created";
    case "void":
      return "Voided";
    case "unvoid":
      return "Restored";
    case "delete":
      return "Deleted";
    default:
      return "Changed";
  }
}
