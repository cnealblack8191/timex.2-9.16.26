/** Shared device-key check + CORS helpers for the public kiosk API. */

export const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
  "Access-Control-Allow-Headers": "content-type,x-kiosk-key",
  "Cache-Control": "no-store",
};

export function preflight() {
  return new Response(null, { status: 204, headers: corsHeaders });
}

export function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function safeEqual(a: string, b: string) {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i += 1) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

/** Returns a 401 Response when the device key is missing or wrong, otherwise null. */
export function requireDeviceKey(request: Request) {
  const expected = process.env["KIOSK_DEVICE_KEY"];
  const provided = request.headers.get("x-kiosk-key") ?? "";
  if (!expected || !provided || !safeEqual(provided, expected)) {
    return json({ error: "Unauthorized" }, 401);
  }
  return null;
}
