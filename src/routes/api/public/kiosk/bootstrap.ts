import { createFileRoute } from "@tanstack/react-router";
import { requireDeviceKey, json, preflight } from "@/lib/kiosk-auth.server";
import { kioskBootstrap } from "@/lib/kiosk-api.server";

export const Route = createFileRoute("/api/public/kiosk/bootstrap")({
  server: {
    handlers: {
      OPTIONS: async () => preflight(),
      GET: async ({ request }) => {
        const denied = requireDeviceKey(request);
        if (denied) return denied;
        try {
          return json(await kioskBootstrap());
        } catch {
          return json({ error: "Could not load kiosk data" }, 500);
        }
      },
    },
  },
});
