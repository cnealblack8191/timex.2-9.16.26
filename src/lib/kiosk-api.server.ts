/**
 * Server-side kiosk logic shared by the public mobile API routes.
 * Uses the service-role client; every caller must already be verified.
 */

type PunchBody = {
  punch_id: string;
  employee_id: string;
  job_id: string;
  action: "in" | "out";
  at: string;
  job_overridden?: boolean;
  source?: string;
};

function dateKey(iso: string) {
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

async function admin() {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  return supabaseAdmin;
}

/** Everything a device needs to run offline: divisions, jobs and active employees. */
export async function kioskBootstrap() {
  const db = await admin();
  const [divisions, jobs, employees] = await Promise.all([
    db.from("divisions").select("id,name,code").order("name"),
    db.from("jobs").select("id,number,name,location,active").eq("active", true).order("number"),
    db
      .from("employees")
      .select("id,first_name,last_name,division_id,assigned_job_id")
      .eq("active", true)
      .order("last_name"),
  ]);
  const err = divisions.error ?? jobs.error ?? employees.error;
  if (err) throw err;
  return {
    synced_at: new Date().toISOString(),
    divisions: divisions.data ?? [],
    jobs: jobs.data ?? [],
    employees: employees.data ?? [],
  };
}

/** Current open punch for an employee, or null when they are clocked out. */
export async function kioskStatus(employeeId: string) {
  const db = await admin();
  const { data, error } = await db
    .from("time_entries")
    .select("id,job_id,clock_in,work_date")
    .eq("employee_id", employeeId)
    .eq("entry_type", "work")
    .is("clock_out", null)
    .order("clock_in", { ascending: false })
    .limit(1);
  if (error) throw error;
  const open = (data ?? [])[0] ?? null;
  return { employee_id: employeeId, clocked_in: Boolean(open), open_entry: open };
}

/**
 * Applies one punch. Safe to retry: a punch_id that was already recorded
 * returns the original result instead of creating a duplicate.
 */
export async function applyKioskPunch(punch: PunchBody) {
  const db = await admin();

  const { data: dupe, error: dupeError } = await db
    .from("time_entries")
    .select("id")
    .eq("client_punch_id", punch.punch_id)
    .maybeSingle();
  if (dupeError) throw dupeError;
  if (dupe) {
    return { punch_id: punch.punch_id, ok: true, duplicate: true, message: "Already recorded" };
  }

  const { data: openRows, error: openError } = await db
    .from("time_entries")
    .select("id")
    .eq("employee_id", punch.employee_id)
    .eq("entry_type", "work")
    .is("clock_out", null)
    .order("clock_in", { ascending: false })
    .limit(1);
  if (openError) throw openError;
  const open = (openRows ?? [])[0];

  if (punch.action === "out") {
    if (!open) {
      return {
        punch_id: punch.punch_id,
        ok: false,
        duplicate: false,
        message: "No open punch to close — not clocked in.",
      };
    }
    const { error } = await db
      .from("time_entries")
      .update({ clock_out: punch.at, client_punch_id: punch.punch_id })
      .eq("id", open.id);
    if (error) throw error;
    return { punch_id: punch.punch_id, ok: true, duplicate: false, message: "Clocked out" };
  }

  if (open) {
    const { error } = await db
      .from("time_entries")
      .update({ clock_out: punch.at })
      .eq("id", open.id);
    if (error) throw error;
  }

  const { error } = await db.from("time_entries").insert({
    employee_id: punch.employee_id,
    job_id: punch.job_id,
    work_date: dateKey(punch.at),
    clock_in: punch.at,
    entry_type: "work",
    job_overridden: punch.job_overridden ?? false,
    client_punch_id: punch.punch_id,
    source: punch.source ?? "mobile",
  });
  if (error) throw error;

  return {
    punch_id: punch.punch_id,
    ok: true,
    duplicate: false,
    message: open ? "Switched jobs — clocked in" : "Clocked in",
  };
}

/** Checks the supervisor adjustment code. */
export async function verifyPin(pin: string) {
  const db = await admin();
  const { data, error } = await db
    .from("app_settings")
    .select("value")
    .eq("key", "kiosk_pin")
    .maybeSingle();
  if (error) throw error;
  return (data?.value ?? "8141") === pin.trim();
}
