import { createFileRoute } from "@tanstack/react-router";
import { authenticateCronRequest } from "@/integrations/supabase/cron-auth";

/**
 * Scheduled housekeeping: delete punch photos past the retention window.
 * Authenticated with the Lovable cron secret (Authorization: Bearer ...).
 * Schedule it daily in Lovable Cloud; it is idempotent and safe to re-run.
 */
async function run(request: Request) {
  const denied = await authenticateCronRequest(request);
  if (denied) return denied;
  try {
    const { purgeOldPunchPhotos } = await import("@/lib/punch-photos.server");
    const result = await purgeOldPunchPhotos();
    return Response.json({ ok: true, ...result });
  } catch (error) {
    console.error("purge-photos failed:", error);
    return Response.json({ ok: false, error: "Purge failed" }, { status: 500 });
  }
}

export const Route = createFileRoute("/api/cron/purge-photos")({
  server: {
    handlers: {
      GET: async ({ request }) => run(request),
      POST: async ({ request }) => run(request),
    },
  },
});
