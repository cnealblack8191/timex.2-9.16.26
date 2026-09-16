/**
 * Registers the kiosk service worker so /kiosk and /adjustments open with no
 * signal once they have been visited online. Silent on browsers or origins
 * that cannot run one.
 */
export function registerKioskServiceWorker() {
  if (typeof window === "undefined" || !("serviceWorker" in navigator)) return;
  const secure = window.location.protocol === "https:" || window.location.hostname === "localhost";
  if (!secure) return;
  navigator.serviceWorker.register("/sw.js", { scope: "/" }).catch(() => {
    // Offline shell is a convenience; punching keeps working without it while the tab is open.
  });
}
