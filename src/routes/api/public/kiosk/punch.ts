import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import { requireDeviceKey, json, preflight } from "@/lib/kiosk-auth.server";
import { applyKioskPunch } from "@/lib/kiosk-api.server";

const punchSchema = z.object({
  punch_id: z.string().min(8).max(64),
  employee_id: z.string().uuid(),
  job_id: z.string().uuid(),
  action: z.enum(["in", "out"]),
  at: z.string().datetime({ offset: true }),
  job_overridden: z.boolean().optional(),
  source: z.string().max(32).optional(),
  /** Optional compressed JPEG (base64 or data URL), max ~1MB encoded. */
  photo: z.string().max(1_400_000).optional(),
});

const bodySchema = z.object({ punches: z.array(punchSchema).min(1).max(200) });

export const Route = createFileRoute("/api/public/kiosk/punch")({
  server: {
    handlers: {
      OPTIONS: async () => preflight(),
      POST: async ({ request }) => {
        const denied = requireDeviceKey(request);
        if (denied) return denied;

        let parsed;
        try {
          const raw = await request.json();
          parsed = bodySchema.parse(
            Array.isArray(raw) ? { punches: raw } : raw?.punches ? raw : { punches: [raw] },
          );
        } catch {
          return json({ error: "Invalid punch payload" }, 400);
        }

        const results = [];
        for (const punch of parsed.punches) {
          try {
            results.push(
              await applyKioskPunch({
                punch_id: punch.punch_id,
                employee_id: punch.employee_id,
                job_id: punch.job_id,
                action: punch.action,
                at: punch.at,
                job_overridden: punch.job_overridden ?? false,
                photo: punch.photo ?? null,
                source: punch.source ?? "mobile",
              }),
            );
          } catch {
            // retryable: the device keeps this punch queued and sends it again
            results.push({
              punch_id: punch.punch_id,
              ok: false,
              duplicate: false,
              retry: true,
              message: "Could not save punch",
            });
          }
        }
        return json({ results });
      },
    },
  },
});
