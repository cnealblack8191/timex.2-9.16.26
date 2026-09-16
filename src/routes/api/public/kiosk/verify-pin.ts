import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import { clientIp, json, preflight, requireDeviceKey } from "@/lib/kiosk-auth.server";
import { verifyPin } from "@/lib/kiosk-api.server";

const bodySchema = z.object({ pin: z.string().min(4).max(8) });

/**
 * Gate for the supervisor Adjustments screen. Five wrong codes from one address
 * (or fifty from anywhere) in fifteen minutes lock the code for fifteen minutes
 * and return 429 with `retryAfterSeconds`. A correct code returns a 15-minute
 * `token` for future adjustment endpoints.
 */
export const Route = createFileRoute("/api/public/kiosk/verify-pin")({
  server: {
    handlers: {
      OPTIONS: async () => preflight(),
      POST: async ({ request }) => {
        const denied = requireDeviceKey(request);
        if (denied) return denied;
        let pin: string;
        try {
          pin = bodySchema.parse(await request.json()).pin;
        } catch {
          return json({ ok: false }, 400);
        }
        try {
          const result = await verifyPin(pin, clientIp(request));
          if (!result.ok && result.locked) return json(result, 429);
          return json(result);
        } catch {
          return json({ ok: false, error: "Could not check the code" }, 500);
        }
      },
    },
  },
});
