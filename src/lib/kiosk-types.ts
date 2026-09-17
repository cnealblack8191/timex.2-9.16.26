/**
 * Types shared by the kiosk browser code and the kiosk server code.
 * This file must stay free of server-only or browser-only imports.
 */

export type KioskEmployee = {
  id: string;
  first_name: string;
  last_name: string;
  division_id: string | null;
  assigned_job_id: string | null;
};

export type KioskJob = {
  id: string;
  number: string;
  name: string;
  location: string | null;
  active: boolean;
};

export type KioskDivision = { id: string; name: string; code: string };

export type KioskOpenEntry = {
  id: string;
  employee_id: string;
  job_id: string | null;
  clock_in: string | null;
  work_date: string;
};

/** Everything a kiosk needs to run, cached on the device for offline use. */
export type KioskBootstrap = {
  synced_at: string;
  timezone: string;
  divisions: KioskDivision[];
  jobs: KioskJob[];
  employees: KioskEmployee[];
  open_entries: KioskOpenEntry[];
};

export type KioskPunchInput = {
  /** Device-generated id, reused on every retry so a punch is never recorded twice. */
  punch_id: string;
  employee_id: string;
  job_id: string;
  action: "in" | "out";
  /** Real punch time, ISO 8601 with offset. Not the sync time. */
  at: string;
  job_overridden: boolean;
  /** Optional compressed JPEG data URL. Never blocks the punch. */
  photo?: string | null | undefined;
};

export type KioskPunchResult = {
  punch_id: string;
  ok: boolean;
  duplicate: boolean;
  /** True when the device should keep the punch queued and send it again. */
  retry?: boolean;
  message: string;
};

/** Photos are kept this many days, then deleted by the scheduled purge. */
export const PHOTO_RETENTION_DAYS = 30;

/** React Query key shared by the kiosk and adjustments screens. */
export const KIOSK_BOOTSTRAP_KEY = ["kiosk-bootstrap"] as const;
