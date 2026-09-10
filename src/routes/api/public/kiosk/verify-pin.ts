import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import { requireDeviceKey, json, preflight } from "@/lib/kiosk-auth.server";
import { verifyPin } from "@/lib/kiosk-api.server";

const bodySchema = z.object({ pin: z.string().min(4).max(8) });

export const Route = createFileRoute("/api/public/kiosk/verify-pin")({
  server: {
    handlers: {
      OPTIONS: async () => preflight(),
      POST: async ({ request }) => {
        const denied = requireDeviceKey(request);
        if (denied) return denied;
        try {
          const { pin } = bodySchema.parse(await request.json());
          return json({ ok: await verifyPin(pin) });
        } catch {
          return json({ ok: false }, 400);
        }
      },
    },
  },
});
