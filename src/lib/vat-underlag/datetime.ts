/**
 * Deterministic date helpers. Using Intl with an explicit timeZone is a pure
 * function of its ISO input — it reads NO clock — so it is safe in this lib.
 */

/**
 * Extract the calendar date (YYYY-MM-DD) of an ISO timestamp as observed in the
 * given IANA timezone. Deterministic: same input → same output.
 */
export function zonedDate(iso: string, timeZone: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) {
    // Not a parseable timestamp — fall back to the leading date-looking prefix.
    const m = iso.match(/^\d{4}-\d{2}-\d{2}/);
    return m ? m[0] : iso;
  }
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(d);
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "";
  return `${get("year")}-${get("month")}-${get("day")}`;
}

export const DEFAULT_TIMEZONE = "Europe/Stockholm";
