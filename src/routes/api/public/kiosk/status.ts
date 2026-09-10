import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import { requireDeviceKey, json, preflight } from "@/lib/kiosk-auth.server";
import { kioskStatus } from "@/lib/kiosk-api.server";

export const Route = createFileRoute("/api/public/kiosk/status")({
  server: {
    handlers: {
      OPTIONS: async () => preflight(),
      GET: async ({ request }) => {
        const denied = requireDeviceKey(request);
        if (denied) return denied;
        const id = new URL(request.url).searchParams.get("employee_id") ?? "";
        if (!z.string().uuid().safeParse(id).success) {
          return json({ error: "employee_id must be a valid id" }, 400);
        }
        try {
          return json(await kioskStatus(id));
        } catch {
          return json({ error: "Could not read status" }, 500);
        }
      },
    },
  },
});
