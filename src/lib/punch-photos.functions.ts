import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

export { PHOTO_RETENTION_DAYS } from "./kiosk-types";

const BUCKET = "punch-photos";

/**
 * Office-side: hands back a short-lived link to a punch photo, only to a
 * signed-in user who is allowed to see that employee. The entry is read
 * through the caller's own client, so row level security decides.
 */
export const getPunchPhotoUrl = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z.object({ entry_id: z.string().uuid(), kind: z.enum(["in", "out"]) }).parse(input),
  )
  .handler(async ({ data, context }) => {
    const { data: entry, error } = await context.supabase
      .from("time_entries")
      .select("clock_in_photo,clock_out_photo")
      .eq("id", data.entry_id)
      .maybeSingle();
    if (error) throw error;
    const path = data.kind === "in" ? entry?.clock_in_photo : entry?.clock_out_photo;
    if (!path) return { url: null as string | null };

    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: signed, error: signError } = await supabaseAdmin.storage
      .from(BUCKET)
      .createSignedUrl(path, 300);
    if (signError) throw signError;
    return { url: signed?.signedUrl ?? null };
  });
