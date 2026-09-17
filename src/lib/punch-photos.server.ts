import { PHOTO_RETENTION_DAYS } from "./kiosk-types";

const BUCKET = "punch-photos";

/**
 * Deletes punch photos older than the retention window and clears their
 * references. Runs from the scheduled cron route, never from a page load.
 */
export async function purgeOldPunchPhotos(): Promise<{ removed: number; entries: number }> {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const cutoff = new Date(Date.now() - PHOTO_RETENTION_DAYS * 86400000).toISOString().slice(0, 10);

  const { data: rows, error } = await supabaseAdmin
    .from("time_entries")
    .select("id,clock_in_photo,clock_out_photo")
    .lt("work_date", cutoff)
    .or("clock_in_photo.not.is.null,clock_out_photo.not.is.null")
    .limit(500);
  if (error) throw error;
  if (!rows || rows.length === 0) return { removed: 0, entries: 0 };

  const paths = rows.flatMap((r) =>
    [r.clock_in_photo, r.clock_out_photo].filter((p): p is string => Boolean(p)),
  );
  if (paths.length > 0) {
    const { error: removeError } = await supabaseAdmin.storage.from(BUCKET).remove(paths);
    if (removeError) throw removeError;
  }
  const { error: updateError } = await supabaseAdmin
    .from("time_entries")
    .update({ clock_in_photo: null, clock_out_photo: null })
    .in(
      "id",
      rows.map((r) => r.id),
    );
  if (updateError) throw updateError;
  return { removed: paths.length, entries: rows.length };
}
