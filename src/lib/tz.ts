/**
 * Company-timezone date math. Servers on Lovable Cloud run in UTC, so a punch
 * at 7:30 pm Eastern would otherwise be filed under tomorrow's work date.
 * Everything that turns an instant into a YYYY-MM-DD goes through here.
 */

export const DEFAULT_TIMEZONE = "America/New_York";

const formatters = new Map<string, Intl.DateTimeFormat>();

export function isValidTimeZone(timeZone: string): boolean {
  try {
    new Intl.DateTimeFormat("en-CA", { timeZone });
    return true;
  } catch {
    return false;
  }
}

function formatterFor(timeZone: string) {
  let formatter = formatters.get(timeZone);
  if (!formatter) {
    formatter = new Intl.DateTimeFormat("en-CA", {
      timeZone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    });
    formatters.set(timeZone, formatter);
  }
  return formatter;
}

/** The calendar date (YYYY-MM-DD) of an instant as seen on a wall clock in the zone. */
export function dateKeyInZone(instant: string | Date, timeZone: string = DEFAULT_TIMEZONE): string {
  const date = typeof instant === "string" ? new Date(instant) : instant;
  if (Number.isNaN(date.getTime())) throw new Error("Invalid timestamp");
  const zone = isValidTimeZone(timeZone) ? timeZone : DEFAULT_TIMEZONE;
  const parts = formatterFor(zone).formatToParts(date);
  const part = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((p) => p.type === type)?.value ?? "";
  return `${part("year")}-${part("month")}-${part("day")}`;
}
