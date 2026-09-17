/**
 * Server functions behind the web kiosk and the supervisor Adjustments screen.
 * The browser never touches the database for these flows; everything runs
 * through the service role on the server, mirroring the mobile API.
 */

import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import type { KioskBootstrap, KioskPunchResult } from "./kiosk-types";
import type { TimeEntry } from "./timekeeping";

const uuid = z.string().uuid();
const dateKey = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Expected YYYY-MM-DD");
const token = z.string().min(20).max(1024);

const punchSchema = z.object({
  punch_id: z.string().min(8).max(64),
  employee_id: uuid,
  job_id: uuid,
  action: z.enum(["in", "out"]),
  at: z.string().datetime({ offset: true }),
  job_overridden: z.boolean().default(false),
  /** Optional compressed JPEG data URL, max ~1MB encoded. */
  photo: z.string().max(1_400_000).nullish(),
});

/** Active employees, active jobs, groups and open punches. Cached on the device. */
export const kioskBootstrap = createServerFn({ method: "POST" }).handler(
  async (): Promise<KioskBootstrap> => {
    const api = await import("@/lib/kiosk-api.server");
    return api.kioskBootstrap();
  },
);

/** One punch from the web kiosk. Idempotent on punch_id. */
export const kioskPunch = createServerFn({ method: "POST" })
  .inputValidator((input: unknown) => punchSchema.parse(input))
  .handler(async ({ data }): Promise<KioskPunchResult> => {
    const api = await import("@/lib/kiosk-api.server");
    return api.applyKioskPunch({
      punch_id: data.punch_id,
      employee_id: data.employee_id,
      job_id: data.job_id,
      action: data.action,
      at: data.at,
      job_overridden: data.job_overridden,
      photo: data.photo ?? null,
      source: "kiosk-web",
    });
  });

export type AdjustmentEntriesResult =
  { ok: true; entries: TimeEntry[] } | { ok: false; locked: true };

/** The employee's punches for one day, for the supervisor Adjustments screen. */
export const adjustmentEntries = createServerFn({ method: "POST" })
  .inputValidator((input: unknown) =>
    z.object({ token, employee_id: uuid, date: dateKey }).parse(input),
  )
  .handler(async ({ data }): Promise<AdjustmentEntriesResult> => {
    const api = await import("@/lib/kiosk-api.server");
    if (!(await api.verifyAdjustmentToken(data.token))) return { ok: false, locked: true };
    return { ok: true, entries: await api.listAdjustmentEntries(data.employee_id, data.date) };
  });

export type SaveAdjustmentResult =
  { ok: boolean; message: string; locked?: false } | { ok: false; message: string; locked: true };

/** Corrects an existing punch or adds a missing one. Requires the supervisor token. */
export const saveAdjustment = createServerFn({ method: "POST" })
  .inputValidator((input: unknown) =>
    z
      .object({
        token,
        employee_id: uuid,
        entry_id: uuid.nullable(),
        job_id: uuid.nullable(),
        clock_in: z.string().datetime({ offset: true }).nullable(),
        clock_out: z.string().datetime({ offset: true }).nullable(),
        reason: z.string().max(1000),
      })
      .parse(input),
  )
  .handler(async ({ data }): Promise<SaveAdjustmentResult> => {
    const api = await import("@/lib/kiosk-api.server");
    if (!(await api.verifyAdjustmentToken(data.token))) {
      return {
        ok: false,
        locked: true,
        message: "Your supervisor session expired. Enter the code again.",
      };
    }
    const { token: _token, ...input } = data;
    return api.saveAdjustment(input);
  });
