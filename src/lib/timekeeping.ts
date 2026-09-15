import { supabase } from "@/integrations/supabase/client";

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
};

export const fullName = (e: Employee) => `${e.first_name} ${e.last_name}`;

export const jobLabel = (j?: Job | null) =>
  j ? `#${j.number} · ${j.name}` : "Unassigned";

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

/* ---------- data access ---------- */

export async function fetchDivisions() {
  const { data, error } = await supabase.from("divisions").select("*").order("name");
  if (error) throw error;
  return (data ?? []) as Division[];
}

export async function fetchJobs() {
  const { data, error } = await supabase.from("jobs").select("*").order("number");
  if (error) throw error;
  return (data ?? []) as Job[];
}

export async function fetchEmployees() {
  const { data, error } = await supabase
    .from("employees")
    .select("*")
    .eq("active", true)
    .order("last_name");
  if (error) throw error;
  return (data ?? []) as Employee[];
}

export async function fetchAllEmployees() {
  const { data, error } = await supabase.from("employees").select("*").order("last_name");
  if (error) throw error;
  return (data ?? []) as Employee[];
}

export async function fetchEntriesBetween(from: string, to: string) {
  const { data, error } = await supabase
    .from("time_entries")
    .select("*")
    .gte("work_date", from)
    .lte("work_date", to)
    .order("work_date", { ascending: false })
    .order("clock_in", { ascending: true });
  if (error) throw error;
  return (data ?? []) as TimeEntry[];
}

export async function fetchOpenEntries() {
  const { data, error } = await supabase
    .from("time_entries")
    .select("*")
    .is("clock_out", null)
    .eq("entry_type", "work")
    .order("clock_in", { ascending: true });
  if (error) throw error;
  return (data ?? []) as TimeEntry[];
}

export type PunchInput = {
  employee_id: string;
  job_id: string;
  action: "in" | "out";
  at: string;
  job_overridden: boolean;
  /** Device-generated id so a resent punch is never recorded twice. */
  client_punch_id?: string;
};

/** Applies a punch. Returns a short human-readable confirmation. */
export async function applyPunch(punch: PunchInput) {
  if (punch.client_punch_id) {
    const { data: dupe } = await supabase
      .from("time_entries")
      .select("id")
      .eq("client_punch_id", punch.client_punch_id)
      .maybeSingle();
    if (dupe) return "Already recorded";
  }

  const { data: open, error: openError } = await supabase
    .from("time_entries")
    .select("*")
    .eq("employee_id", punch.employee_id)
    .is("clock_out", null)
    .eq("entry_type", "work")
    .order("clock_in", { ascending: false })
    .limit(1);
  if (openError) throw openError;
  const openEntry = (open ?? [])[0] as TimeEntry | undefined;

  if (punch.action === "out") {
    if (!openEntry) throw new Error("No open punch to close — you are not clocked in.");
    const { error } = await supabase
      .from("time_entries")
      .update({ clock_out: punch.at, client_punch_id: punch.client_punch_id ?? null })
      .eq("id", openEntry.id);
    if (error) throw error;
    return "Clocked out";
  }

  if (openEntry) {
    // close the previous job automatically, then open the new one
    const { error } = await supabase
      .from("time_entries")
      .update({ clock_out: punch.at })
      .eq("id", openEntry.id);
    if (error) throw error;
  }

  const workDate = toDateKey(new Date(punch.at));
  const { error } = await supabase.from("time_entries").insert({
    employee_id: punch.employee_id,
    job_id: punch.job_id,
    work_date: workDate,
    clock_in: punch.at,
    entry_type: "work",
    job_overridden: punch.job_overridden,
    client_punch_id: punch.client_punch_id ?? null,
    source: "kiosk-web",
  });
  if (error) throw error;
  return openEntry ? "Switched jobs — clocked in" : "Clocked in";
}
