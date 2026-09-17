import { supabase } from "@/integrations/supabase/client";
import type { Database, Json } from "@/integrations/supabase/types";

export type Division = { id: string; name: string; code: string };

export type Job = {
  id: string;
  number: string;
  name: string;
  location: string | null;
  active: boolean;
};

export type Employee = {
  id: string;
  first_name: string;
  last_name: string;
  division_id: string | null;
  assigned_job_id: string | null;
  active: boolean;
};

export type EntryType = "work" | "pto" | "holiday";

export type TimeEntry = {
  id: string;
  employee_id: string;
  job_id: string | null;
  work_date: string;
  clock_in: string | null;
  clock_out: string | null;
  entry_type: string;
  manual_hours: number | null;
  notes: string | null;
  job_overridden: boolean;
  edited: boolean;
  created_at: string;
  clock_in_photo?: string | null;
  clock_out_photo?: string | null;
  /** Voided entries stay on record but count for nothing. Only an admin can restore one. */
  voided: boolean;
  voided_at: string | null;
  voided_by: string | null;
  void_reason: string | null;
  /** Set by the database when a kiosk punch lands in a week the office had already closed. */
  after_close: boolean;
};

/** A payroll week the office has closed (or closed and reopened). Keyed by its Sunday. */
export type PayPeriod = {
  week_start: string;
  status: string;
  closed_at: string;
  closed_by: string | null;
  closed_by_name: string | null;
  reopened_at: string | null;
  reopened_by: string | null;
  reopened_by_name: string | null;
  updated_at: string;
};

/** One recorded change to a time entry, written by a database trigger. */
export type TimeEntryRevision = {
  id: string;
  entry_id: string;
  employee_id: string;
  action: string;
  changed_at: string;
  changed_by: string | null;
  changed_by_name: string | null;
  changed_via: string;
  old_row: Record<string, unknown> | null;
  new_row: Record<string, unknown> | null;
};

export const fullName = (e: Pick<Employee, "first_name" | "last_name">) =>
  `${e.first_name} ${e.last_name}`;

export const jobLabel = (j?: Job | null) => (j ? `#${j.number} · ${j.name}` : "Unassigned");

/* ---------- week math: payroll week runs Sunday through Saturday ---------- */

export function toDateKey(d: Date) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(
    d.getDate(),
  ).padStart(2, "0")}`;
}

export function weekStart(date: Date = new Date()) {
  const d = new Date(date);
  d.setHours(0, 0, 0, 0);
  const day = d.getDay(); // 0 Sun .. 6 Sat
  d.setDate(d.getDate() - day); // back to Sunday
  return d;
}

export function weekEnd(date: Date = new Date()) {
  const start = weekStart(date);
  const end = new Date(start);
  end.setDate(start.getDate() + 6); // Saturday
  return end;
}

export function weekDays(date: Date = new Date()) {
  const start = weekStart(date);
  return Array.from({ length: 7 }, (_, i) => {
    const d = new Date(start);
    d.setDate(start.getDate() + i);
    return d;
  });
}

export function weekNumber(date: Date = new Date()) {
  const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
  const dayNum = d.getUTCDay() || 7;
  d.setUTCDate(d.getUTCDate() + 4 - dayNum);
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  return Math.ceil(((d.getTime() - yearStart.getTime()) / 86400000 + 1) / 7);
}

export const OVERTIME_THRESHOLD = 40;

export function entryHours(entry: TimeEntry) {
  if (entry.manual_hours != null) return Number(entry.manual_hours);
  if (!entry.clock_in || !entry.clock_out) return 0;
  const ms = new Date(entry.clock_out).getTime() - new Date(entry.clock_in).getTime();
  return Math.max(0, Math.round((ms / 3600000) * 100) / 100);
}

export function formatTime(iso: string | null) {
  if (!iso) return "—";
  return new Date(iso).toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
}

/** Parses a YYYY-MM-DD key as a local date (avoids UTC shifting the day). */
export function parseDateKey(dateStr: string) {
  const parts = dateStr.split("-").map(Number);
  return new Date(parts[0] ?? 1970, (parts[1] ?? 1) - 1, parts[2] ?? 1);
}

export function formatDay(dateStr: string) {
  return parseDateKey(dateStr).toLocaleDateString([], {
    weekday: "short",
    month: "short",
    day: "numeric",
  });
}

/** Converts an ISO timestamp into a value an <input type="datetime-local"> accepts. */
export function toLocalInput(iso: string | null) {
  if (!iso) return "";
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(
    d.getHours(),
  )}:${pad(d.getMinutes())}`;
}

export function fromLocalInput(value: string) {
  return value ? new Date(value).toISOString() : null;
}

/* ---------- data access (office portal, signed-in users, row level security) ---------- */

/**
 * PostgREST returns at most 1,000 rows per request and does not say when it
 * has cut a result short. With 200 people punching, a payroll week is over
 * 2,000 rows, so every list below is read a page at a time until a short page
 * comes back. Each query orders by `id` last so the pages never overlap.
 */
const PAGE_SIZE = 1000;

type PageResult<T> = { data: T[] | null; error: { message: string } | null };

async function pageAll<T>(
  build: (from: number, to: number) => PromiseLike<PageResult<T>>,
): Promise<T[]> {
  const rows: T[] = [];
  for (let from = 0; ; from += PAGE_SIZE) {
    const { data, error } = await build(from, from + PAGE_SIZE - 1);
    if (error) throw error;
    const page = data ?? [];
    rows.push(...page);
    if (page.length < PAGE_SIZE) return rows;
  }
}

export function fetchDivisions() {
  return pageAll<Division>((from, to) =>
    supabase.from("divisions").select("*").order("name").order("id").range(from, to),
  );
}

export function fetchJobs() {
  return pageAll<Job>((from, to) =>
    supabase.from("jobs").select("*").order("number").order("id").range(from, to),
  );
}

export function fetchEmployees() {
  return pageAll<Employee>((from, to) =>
    supabase
      .from("employees")
      .select("*")
      .eq("active", true)
      .order("last_name")
      .order("first_name")
      .order("id")
      .range(from, to),
  );
}

export function fetchAllEmployees() {
  return pageAll<Employee>((from, to) =>
    supabase
      .from("employees")
      .select("*")
      .order("last_name")
      .order("first_name")
      .order("id")
      .range(from, to),
  );
}

/**
 * Entries in a date range. Voided entries are left out unless asked for, so
 * payroll, reports and the time card never count them; Time Entries asks for
 * them to show the greyed-out record.
 */
export function fetchEntriesBetween(
  from: string,
  to: string,
  options: { includeVoided?: boolean } = {},
) {
  return pageAll<TimeEntry>((start, end) => {
    let query = supabase
      .from("time_entries")
      .select("*")
      .gte("work_date", from)
      .lte("work_date", to);
    if (!options.includeVoided) query = query.eq("voided", false);
    return query
      .order("work_date", { ascending: false })
      .order("clock_in", { ascending: true })
      .order("id")
      .range(start, end);
  });
}

export function fetchOpenEntries() {
  return pageAll<TimeEntry>((from, to) =>
    supabase
      .from("time_entries")
      .select("*")
      .is("clock_out", null)
      .eq("entry_type", "work")
      .eq("voided", false)
      .order("clock_in", { ascending: true })
      .order("id")
      .range(from, to),
  );
}

export function fetchPayPeriods() {
  return pageAll<PayPeriod>((from, to) =>
    supabase
      .from("pay_periods")
      .select("*")
      .order("week_start", { ascending: false })
      .range(from, to),
  );
}

type RevisionRow = Database["public"]["Tables"]["time_entry_revisions"]["Row"];

const asRecord = (value: Json | null): Record<string, unknown> | null =>
  value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;

export async function fetchRevisions(entryId: string): Promise<TimeEntryRevision[]> {
  const rows = await pageAll<RevisionRow>((from, to) =>
    supabase
      .from("time_entry_revisions")
      .select("*")
      .eq("entry_id", entryId)
      .order("changed_at", { ascending: false })
      .order("id")
      .range(from, to),
  );
  return rows.map((row) => ({
    ...row,
    old_row: asRecord(row.old_row),
    new_row: asRecord(row.new_row),
  }));
}
