/**
 * Server-side kiosk logic shared by the web kiosk server functions and the
 * public mobile API routes. Uses the service-role client, so every caller must
 * already be verified: device key (mobile API), supervisor token (adjustments)
 * or a same-origin server function (web kiosk).
 */

import type { KioskBootstrap, KioskPunchInput, KioskPunchResult } from "./kiosk-types";
import type { TimeEntry } from "./timekeeping";
import { safeEqual } from "./kiosk-auth.server";
import { weekStartKey } from "./time-rules";
import { DEFAULT_TIMEZONE, dateKeyInZone, isValidTimeZone } from "./tz";

type PunchBody = KioskPunchInput & { source: string };
type DbError = { code?: string | null; message: string };

async function admin() {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  return supabaseAdmin;
}

/* ---------- settings ---------- */

const SETTINGS_TTL_MS = 5 * 60_000;
const settingsCache = new Map<string, { value: string | null; at: number }>();

async function readSetting(key: string): Promise<string | null> {
  const cached = settingsCache.get(key);
  if (cached && Date.now() - cached.at < SETTINGS_TTL_MS) return cached.value;
  const db = await admin();
  const { data, error } = await db
    .from("app_settings")
    .select("value")
    .eq("key", key)
    .maybeSingle();
  if (error) throw error;
  const value = data?.value ?? null;
  settingsCache.set(key, { value, at: Date.now() });
  return value;
}

/** The zone every work date is computed in. Stored in app_settings as `timezone`. */
export async function companyTimezone(): Promise<string> {
  const value = await readSetting("timezone");
  return value && isValidTimeZone(value) ? value : DEFAULT_TIMEZONE;
}

/* ---------- photos ---------- */

function decodeDataUrl(dataUrl: string): Uint8Array<ArrayBuffer> {
  const base64 = dataUrl.includes(",") ? dataUrl.slice(dataUrl.indexOf(",") + 1) : dataUrl;
  const binary = atob(base64);
  const bytes = new Uint8Array(new ArrayBuffer(binary.length));
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

/** Stores a punch photo in the private bucket and links it to the entry. Never throws. */
async function storePhoto(entryId: string, kind: "in" | "out", photo: string) {
  try {
    const db = await admin();
    const path = `${new Date().toISOString().slice(0, 10)}/${entryId}-${kind}.jpg`;
    const { error } = await db.storage
      .from("punch-photos")
      .upload(path, decodeDataUrl(photo), { contentType: "image/jpeg", upsert: true });
    if (error) return;
    await db
      .from("time_entries")
      .update(kind === "in" ? { clock_in_photo: path } : { clock_out_photo: path })
      .eq("id", entryId);
  } catch (err) {
    // A punch is never rejected because its photo failed.
    console.error("punch photo skipped:", err);
  }
}

/* ---------- bootstrap / status ---------- */

/** Everything a device needs to run offline: groups, active jobs, active employees, open punches. */
export async function kioskBootstrap(): Promise<KioskBootstrap> {
  const db = await admin();
  const [divisions, jobs, employees, open, timezone] = await Promise.all([
    db.from("divisions").select("id,name,code").order("name"),
    db.from("jobs").select("id,number,name,location,active").eq("active", true).order("number"),
    db
      .from("employees")
      .select("id,first_name,last_name,division_id,assigned_job_id")
      .eq("active", true)
      .order("last_name")
      .order("first_name"),
    db
      .from("time_entries")
      .select("id,employee_id,job_id,clock_in,work_date")
      .eq("entry_type", "work")
      .eq("voided", false)
      .is("clock_out", null),
    companyTimezone(),
  ]);
  const err = divisions.error ?? jobs.error ?? employees.error ?? open.error;
  if (err) throw err;
  return {
    synced_at: new Date().toISOString(),
    timezone,
    divisions: divisions.data ?? [],
    jobs: jobs.data ?? [],
    employees: employees.data ?? [],
    open_entries: open.data ?? [],
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
    .eq("voided", false)
    .is("clock_out", null)
    .order("clock_in", { ascending: false })
    .limit(1);
  if (error) throw error;
  const open = (data ?? [])[0] ?? null;
  return { employee_id: employeeId, clocked_in: Boolean(open), open_entry: open };
}

/* ---------- punches ---------- */

const reject = (punch_id: string, message: string): KioskPunchResult => ({
  punch_id,
  ok: false,
  duplicate: false,
  message,
});

const recorded = (punch_id: string, duplicate: boolean, message: string): KioskPunchResult => ({
  punch_id,
  ok: true,
  duplicate,
  message,
});

function isUniqueViolation(error: DbError, indexName: string) {
  return error.code === "23505" && error.message.includes(indexName);
}

/**
 * Applies one punch. Safe to retry: a punch_id that was already recorded
 * returns `duplicate: true` instead of creating a second entry. Two devices
 * racing to open a punch for the same person are stopped by the database's
 * one-open-punch index; the loser is told to retry and then sees the open punch.
 */
export async function applyKioskPunch(punch: PunchBody): Promise<KioskPunchResult> {
  const db = await admin();
  const at = new Date(punch.at);
  if (Number.isNaN(at.getTime())) return reject(punch.punch_id, "Punch time is not valid.");

  const { data: dupe, error: dupeError } = await db
    .from("time_entries")
    .select("id")
    .eq("client_punch_id", punch.punch_id)
    .maybeSingle();
  if (dupeError) throw dupeError;
  if (dupe) return recorded(punch.punch_id, true, "Already recorded");

  const { data: employee, error: employeeError } = await db
    .from("employees")
    .select("id,active")
    .eq("id", punch.employee_id)
    .maybeSingle();
  if (employeeError) throw employeeError;
  if (!employee) return reject(punch.punch_id, "Employee not found.");
  if (!employee.active) return reject(punch.punch_id, "This employee is no longer active.");

  const { data: openRows, error: openError } = await db
    .from("time_entries")
    .select("id")
    .eq("employee_id", punch.employee_id)
    .eq("entry_type", "work")
    .eq("voided", false)
    .is("clock_out", null)
    .order("clock_in", { ascending: false })
    .limit(1);
  if (openError) throw openError;
  const open = (openRows ?? [])[0];

  if (punch.action === "out") {
    if (!open) return reject(punch.punch_id, "No open punch to close — not clocked in.");
    const { error } = await db
      .from("time_entries")
      .update({ clock_out: at.toISOString(), client_punch_id: punch.punch_id })
      .eq("id", open.id);
    if (error) {
      if (isUniqueViolation(error, "client_punch_id")) {
        return recorded(punch.punch_id, true, "Already recorded");
      }
      throw error;
    }
    if (punch.photo) await storePhoto(open.id, "out", punch.photo);
    return recorded(punch.punch_id, false, "Clocked out");
  }

  const { data: job, error: jobError } = await db
    .from("jobs")
    .select("id,active")
    .eq("id", punch.job_id)
    .maybeSingle();
  if (jobError) throw jobError;
  if (!job) return reject(punch.punch_id, "Job not found.");
  if (!job.active) return reject(punch.punch_id, "That job is closed. Pick another job.");

  if (open) {
    // close the previous job automatically, then open the new one
    const { error } = await db
      .from("time_entries")
      .update({ clock_out: at.toISOString() })
      .eq("id", open.id);
    if (error) throw error;
  }

  const { data: inserted, error } = await db
    .from("time_entries")
    .insert({
      employee_id: punch.employee_id,
      job_id: punch.job_id,
      work_date: dateKeyInZone(at, await companyTimezone()),
      clock_in: at.toISOString(),
      entry_type: "work",
      job_overridden: punch.job_overridden,
      client_punch_id: punch.punch_id,
      source: punch.source,
    })
    .select("id")
    .single();
  if (error) {
    if (isUniqueViolation(error, "time_entries_one_open_per_employee")) {
      return {
        punch_id: punch.punch_id,
        ok: false,
        duplicate: false,
        retry: true,
        message: "Another punch for this employee landed at the same moment — retrying.",
      };
    }
    if (isUniqueViolation(error, "client_punch_id")) {
      return recorded(punch.punch_id, true, "Already recorded");
    }
    throw error;
  }
  if (punch.photo && inserted) await storePhoto(inserted.id, "in", punch.photo);

  return recorded(punch.punch_id, false, open ? "Switched jobs — clocked in" : "Clocked in");
}

/* ---------- supervisor code ---------- */

const PIN_KEY = "kiosk_pin";
const PIN_WINDOW_MS = 15 * 60_000;
const PIN_LOCK_MS = 15 * 60_000;
const PIN_MAX_PER_IP = 5;
const PIN_MAX_GLOBAL = 50;

export type PinVerifyResult =
  { ok: true; token: string } | { ok: false; locked: boolean; retryAfterSeconds: number };

type ThrottleRow = {
  key: string;
  failures: number;
  window_start: string;
  locked_until: string | null;
};

/**
 * Checks the supervisor adjustment code. Five wrong tries from one address, or
 * fifty from anywhere, lock the code for fifteen minutes. A correct code
 * returns a short-lived token that the adjustment writes must present.
 */
export async function verifyPin(pin: string, ip: string): Promise<PinVerifyResult> {
  const ipKey = `pin:ip:${ip}`;
  const globalKey = "pin:global";
  const db = await admin();
  const { data: rowsData, error: rowsError } = await db
    .from("auth_throttle")
    .select("*")
    .in("key", [ipKey, globalKey]);
  if (rowsError) throw rowsError;
  const rows = new Map<string, ThrottleRow>((rowsData ?? []).map((r) => [r.key, r]));
  const now = Date.now();

  const lockedUntil = Math.max(
    0,
    ...[ipKey, globalKey].map((key) => {
      const until = rows.get(key)?.locked_until;
      return until ? new Date(until).getTime() : 0;
    }),
  );
  if (lockedUntil > now) {
    return { ok: false, locked: true, retryAfterSeconds: Math.ceil((lockedUntil - now) / 1000) };
  }

  const current = await readSetting(PIN_KEY);
  if (current && safeEqual(pin.trim(), current)) {
    await db.from("auth_throttle").delete().eq("key", ipKey);
    return { ok: true, token: await issueAdjustmentToken() };
  }

  const targets = [
    { key: ipKey, max: PIN_MAX_PER_IP },
    { key: globalKey, max: PIN_MAX_GLOBAL },
  ];
  const updates = targets.map(({ key, max }) => {
    const row = rows.get(key);
    const inWindow = row ? now - new Date(row.window_start).getTime() < PIN_WINDOW_MS : false;
    const failures = (inWindow && row ? row.failures : 0) + 1;
    return {
      key,
      failures,
      window_start: inWindow && row ? row.window_start : new Date(now).toISOString(),
      locked_until: failures >= max ? new Date(now + PIN_LOCK_MS).toISOString() : null,
    };
  });
  const { error: upsertError } = await db
    .from("auth_throttle")
    .upsert(updates, { onConflict: "key" });
  if (upsertError) throw upsertError;

  const locked = updates.some((u) => u.locked_until !== null);
  return { ok: false, locked, retryAfterSeconds: locked ? Math.ceil(PIN_LOCK_MS / 1000) : 0 };
}

/** Changes the code. The caller must already be an authenticated administrator. */
export async function changePin(currentPin: string, newPin: string) {
  const current = await readSetting(PIN_KEY);
  if (!current || !safeEqual(currentPin.trim(), current)) {
    return { ok: false as const, message: "Current code is not correct." };
  }
  const next = newPin.trim();
  if (!/^\d{4,8}$/.test(next)) {
    return { ok: false as const, message: "Use 4 to 8 numbers for the new code." };
  }
  const db = await admin();
  const { error } = await db
    .from("app_settings")
    .upsert({ key: PIN_KEY, value: next }, { onConflict: "key" });
  if (error) throw error;
  settingsCache.delete(PIN_KEY);
  return { ok: true as const, message: "Code updated." };
}

/* ---------- adjustment tokens ---------- */

const TOKEN_TTL_MS = 15 * 60_000;

function tokenSecret(): string {
  const secret =
    process.env["ADJUSTMENT_TOKEN_SECRET"] ||
    process.env["KIOSK_DEVICE_KEY"] ||
    process.env["SUPABASE_SERVICE_ROLE_KEY"];
  if (!secret) throw new Error("No secret is configured to sign adjustment tokens");
  return secret;
}

async function hmacKey() {
  return crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(tokenSecret()),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign", "verify"],
  );
}

function toBase64Url(bytes: ArrayBuffer | Uint8Array): string {
  const view = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  let binary = "";
  for (const b of view) binary += String.fromCharCode(b);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function fromBase64Url(value: string): Uint8Array<ArrayBuffer> {
  const padded = value.replace(/-/g, "+").replace(/_/g, "/");
  const binary = atob(padded + "=".repeat((4 - (padded.length % 4)) % 4));
  const bytes = new Uint8Array(new ArrayBuffer(binary.length));
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

/** A signed, 15-minute pass handed out after a correct supervisor code. */
export async function issueAdjustmentToken(): Promise<string> {
  const payload = new TextEncoder().encode(
    JSON.stringify({ exp: Date.now() + TOKEN_TTL_MS, n: crypto.randomUUID() }),
  );
  const signature = await crypto.subtle.sign("HMAC", await hmacKey(), payload);
  return `${toBase64Url(payload)}.${toBase64Url(signature)}`;
}

export async function verifyAdjustmentToken(token: string): Promise<boolean> {
  const [encodedPayload, encodedSignature] = token.split(".");
  if (!encodedPayload || !encodedSignature) return false;
  try {
    const payload = fromBase64Url(encodedPayload);
    const valid = await crypto.subtle.verify(
      "HMAC",
      await hmacKey(),
      fromBase64Url(encodedSignature),
      payload,
    );
    if (!valid) return false;
    const parsed = JSON.parse(new TextDecoder().decode(payload)) as { exp?: unknown };
    return typeof parsed.exp === "number" && parsed.exp > Date.now();
  } catch {
    return false;
  }
}

/* ---------- supervisor adjustments ---------- */

const MAX_PUNCH_SPAN_MS = 24 * 60 * 60_000;

export async function listAdjustmentEntries(
  employeeId: string,
  date: string,
): Promise<TimeEntry[]> {
  const db = await admin();
  const { data, error } = await db
    .from("time_entries")
    .select("*")
    .eq("employee_id", employeeId)
    .eq("work_date", date)
    .eq("voided", false)
    .order("clock_in", { ascending: true });
  if (error) throw error;
  return (data ?? []) as TimeEntry[];
}

/** True when the office has closed the payroll week that contains the date. */
async function isWeekClosed(dateKey: string): Promise<boolean> {
  const db = await admin();
  const { data, error } = await db
    .from("pay_periods")
    .select("status")
    .eq("week_start", weekStartKey(dateKey))
    .maybeSingle();
  if (error) throw error;
  return data?.status === "closed";
}

export type AdjustmentInput = {
  employee_id: string;
  /** Existing entry to correct, or null to add a missing punch. */
  entry_id: string | null;
  job_id: string | null;
  clock_in: string | null;
  clock_out: string | null;
  reason: string;
};

export type AdjustmentResult = { ok: boolean; message: string };

/** Corrects or adds one punch from the jobsite, with the reason appended to its notes. */
export async function saveAdjustment(input: AdjustmentInput): Promise<AdjustmentResult> {
  const reason = input.reason.trim();
  if (reason.length < 3) return { ok: false, message: "A reason is required." };

  if (!input.clock_in) return { ok: false, message: "A clock-in time is required." };
  const inMs = new Date(input.clock_in).getTime();
  if (Number.isNaN(inMs)) return { ok: false, message: "The clock-in time is not valid." };
  let outIso: string | null = null;
  if (input.clock_out) {
    const outMs = new Date(input.clock_out).getTime();
    if (Number.isNaN(outMs)) return { ok: false, message: "The clock-out time is not valid." };
    if (outMs <= inMs) return { ok: false, message: "Clock out must be after clock in." };
    if (outMs - inMs > MAX_PUNCH_SPAN_MS) {
      return { ok: false, message: "A single punch cannot be longer than 24 hours." };
    }
    outIso = new Date(outMs).toISOString();
  }
  const inIso = new Date(inMs).toISOString();

  const db = await admin();
  const { data: employee, error: employeeError } = await db
    .from("employees")
    .select("id")
    .eq("id", input.employee_id)
    .maybeSingle();
  if (employeeError) throw employeeError;
  if (!employee) return { ok: false, message: "Employee not found." };

  if (input.job_id) {
    const { data: job, error: jobError } = await db
      .from("jobs")
      .select("id")
      .eq("id", input.job_id)
      .maybeSingle();
    if (jobError) throw jobError;
    if (!job) return { ok: false, message: "Job not found." };
  }

  const timezone = await companyTimezone();
  const stamp = new Date().toLocaleString("en-US", {
    timeZone: timezone,
    dateStyle: "short",
    timeStyle: "short",
  });
  const noteLine = `Manual adjustment ${stamp}: ${reason}`;
  const workDate = dateKeyInZone(inIso, timezone);
  const openConflict = {
    ok: false,
    message: "This employee already has an open punch. Close that one first.",
  };
  const weekClosed = {
    ok: false,
    message: "The office has closed that payroll week. Ask them to make the correction.",
  };

  if (await isWeekClosed(workDate)) return weekClosed;

  if (input.entry_id) {
    const { data: existing, error: existingError } = await db
      .from("time_entries")
      .select("id,employee_id,entry_type,notes,work_date,voided")
      .eq("id", input.entry_id)
      .maybeSingle();
    if (existingError) throw existingError;
    if (!existing || existing.employee_id !== input.employee_id || existing.voided) {
      return { ok: false, message: "That time entry no longer exists." };
    }
    if (existing.entry_type !== "work") {
      return { ok: false, message: "Only work punches can be adjusted here." };
    }
    if (await isWeekClosed(existing.work_date)) return weekClosed;
    const { error } = await db
      .from("time_entries")
      .update({
        job_id: input.job_id,
        work_date: workDate,
        clock_in: inIso,
        clock_out: outIso,
        edited: true,
        notes: [existing.notes, noteLine].filter(Boolean).join("\n"),
      })
      .eq("id", input.entry_id);
    if (error) {
      if (isUniqueViolation(error, "time_entries_one_open_per_employee")) return openConflict;
      throw error;
    }
    return { ok: true, message: "Time corrected." };
  }

  const { error } = await db.from("time_entries").insert({
    employee_id: input.employee_id,
    job_id: input.job_id,
    work_date: workDate,
    clock_in: inIso,
    clock_out: outIso,
    entry_type: "work",
    edited: true,
    notes: noteLine,
    source: "kiosk-adjust",
  });
  if (error) {
    if (isUniqueViolation(error, "time_entries_one_open_per_employee")) return openConflict;
    throw error;
  }
  return { ok: true, message: "Missing punch added." };
}
