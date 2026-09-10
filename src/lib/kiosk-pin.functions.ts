import { createServerFn } from "@tanstack/react-start";

const KEY = "kiosk_pin";

async function readPin() {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { data, error } = await supabaseAdmin
    .from("app_settings")
    .select("value")
    .eq("key", KEY)
    .maybeSingle();
  if (error) throw error;
  return (data?.value ?? "8141") as string;
}

/** Checks the jobsite adjustment code without ever sending it to the browser. */
export const verifyKioskPin = createServerFn({ method: "POST" })
  .inputValidator((data: { pin: string }) => data)
  .handler(async ({ data }) => {
    const current = await readPin();
    return { ok: data.pin.trim() === current };
  });

/** Changes the code. The current code must be supplied. */
export const changeKioskPin = createServerFn({ method: "POST" })
  .inputValidator((data: { currentPin: string; newPin: string }) => data)
  .handler(async ({ data }) => {
    const current = await readPin();
    if (data.currentPin.trim() !== current) {
      return { ok: false as const, message: "Current code is not correct." };
    }
    const next = data.newPin.trim();
    if (!/^\d{4,8}$/.test(next)) {
      return { ok: false as const, message: "Use 4 to 8 numbers for the new code." };
    }
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { error } = await supabaseAdmin
      .from("app_settings")
      .upsert({ key: KEY, value: next }, { onConflict: "key" });
    if (error) throw error;
    return { ok: true as const, message: "Code updated." };
  });
