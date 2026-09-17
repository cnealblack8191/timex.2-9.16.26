import { createServerFn } from "@tanstack/react-start";
import { getRequest } from "@tanstack/react-start/server";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { assertAdmin } from "@/lib/auth.functions";
import type { PinVerifyResult } from "@/lib/kiosk-api.server";

/**
 * Checks the jobsite adjustment code without ever sending it to the browser.
 * Rate-limited per address and globally; a correct code returns a 15-minute
 * token that the Adjustments screen must send with every change.
 */
export const verifyKioskPin = createServerFn({ method: "POST" })
  .inputValidator((input: unknown) => z.object({ pin: z.string().min(4).max(8) }).parse(input))
  .handler(async ({ data }): Promise<PinVerifyResult> => {
    const api = await import("@/lib/kiosk-api.server");
    const { clientIp } = await import("@/lib/kiosk-auth.server");
    return api.verifyPin(data.pin, clientIp(getRequest()));
  });

/** Changes the code. Administrators only; the current code must be supplied. */
export const changeKioskPin = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z.object({ currentPin: z.string().max(16), newPin: z.string().max(16) }).parse(input),
  )
  .handler(async ({ data, context }) => {
    await assertAdmin(context.supabase, context.userId);
    const api = await import("@/lib/kiosk-api.server");
    return api.changePin(data.currentPin, data.newPin);
  });
