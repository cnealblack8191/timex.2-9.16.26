import { createServerFn } from "@tanstack/react-start";

/** Photos are kept this many days, then deleted automatically. */
export const PHOTO_RETENTION_DAYS = 30;

const BUCKET = "punch-photos";

function decodeDataUrl(dataUrl: string) {
  const base64 = dataUrl.includes(",") ? dataUrl.slice(dataUrl.indexOf(",") + 1) : dataUrl;
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

/**
 * Stores one punch photo (already compressed by the device) and links it to the
 * time entry that carries the given punch id.
 */
export const savePunchPhoto = createServerFn({ method: "POST" })
  .inputValidator((input: { client_punch_id: string; kind: "in" | "out"; data_url: string }) => {
    if (!input?.client_punch_id || !input?.data_url) throw new Error("Missing photo payload");
    if (input.kind !== "in" && input.kind !== "out") throw new Error("Bad photo kind");
    if (input.data_url.length > 1_400_000) throw new Error("Photo too large");
    return input;
  })
  .handler(async ({ data }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: entry, error: findError } = await supabaseAdmin
      .from("time_entries")
      .select("id")
      .eq("client_punch_id", data.client_punch_id)
      .maybeSingle();
    if (findError) throw findError;
    if (!entry) return { ok: false as const, reason: "entry-not-found" };

    const path = `${new Date().toISOString().slice(0, 10)}/${entry.id}-${data.kind}.jpg`;
    const { error: uploadError } = await supabaseAdmin.storage
      .from(BUCKET)
      .upload(path, decodeDataUrl(data.data_url), {
        contentType: "image/jpeg",
        upsert: true,
      });
    if (uploadError) throw uploadError;

    const column = data.kind === "in" ? "clock_in_photo" : "clock_out_photo";
    const { error: updateError } = await supabaseAdmin
      .from("time_entries")
      .update({ [column]: path })
      .eq("id", entry.id);
    if (updateError) throw updateError;

    return { ok: true as const, path };
  });

/** Office-side: hands back a short-lived link, only when someone asks for it. */
export const getPunchPhotoUrl = createServerFn({ method: "POST" })
  .inputValidator((input: { entry_id: string; kind: "in" | "out" }) => input)
  .handler(async ({ data }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: entry, error } = await supabaseAdmin
      .from("time_entries")
      .select("clock_in_photo,clock_out_photo")
      .eq("id", data.entry_id)
      .maybeSingle();
    if (error) throw error;
    const path = data.kind === "in" ? entry?.clock_in_photo : entry?.clock_out_photo;
    if (!path) return { url: null as string | null };
    const { data: signed, error: signError } = await supabaseAdmin.storage
      .from(BUCKET)
      .createSignedUrl(path, 300);
    if (signError) throw signError;
    return { url: signed?.signedUrl ?? null };
  });

/** Deletes photos older than the retention window and clears their references. */
export const purgeOldPunchPhotos = createServerFn({ method: "POST" }).handler(async () => {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const cutoff = new Date(Date.now() - PHOTO_RETENTION_DAYS * 86400000)
    .toISOString()
    .slice(0, 10);

  const { data: rows, error } = await supabaseAdmin
    .from("time_entries")
    .select("id,clock_in_photo,clock_out_photo")
    .lt("work_date", cutoff)
    .or("clock_in_photo.not.is.null,clock_out_photo.not.is.null")
    .limit(500);
  if (error) throw error;
  if (!rows || rows.length === 0) return { removed: 0 };

  const paths = rows.flatMap((r) =>
    [r.clock_in_photo, r.clock_out_photo].filter((p): p is string => Boolean(p)),
  );
  if (paths.length > 0) await supabaseAdmin.storage.from(BUCKET).remove(paths);
  await supabaseAdmin
    .from("time_entries")
    .update({ clock_in_photo: null, clock_out_photo: null })
    .in(
      "id",
      rows.map((r) => r.id),
    );
  return { removed: paths.length };
});
