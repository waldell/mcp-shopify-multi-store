/**
 * Central VAT rate table. THIS IS THE ONE PLACE rates live.
 *
 * ⚠️ VERIFY CURRENT RATES before each accounting period — standard VAT rates
 * change by member-state decision. Values below are the STANDARD rates as
 * understood at time of writing (2026). Cross-check against the destination
 * country's tax authority / the EU "Taxes in Europe" database before filing.
 *
 * SCOPE (v1): STANDARD rate only. Reduced rates (books, food, etc. at 6/12 %)
 * are OUT OF SCOPE.
 * TODO(reduced-rates): handling reduced rates requires grouping on each order's
 * `taxLines` (rate + priced amount per line) instead of assuming one standard
 * rate per destination country. That changes the aggregation key from
 * (store, shipCountry, currency) to (store, shipCountry, currency, ratePct).
 */

/** Standard VAT rate (percent) by ISO 3166-1 alpha-2 destination country. */
export const STANDARD_VAT_RATES: Record<string, number> = {
  // Nordics we sell from / ship to
  SE: 25, // Sweden
  DK: 25, // Denmark
  FI: 25.5, // Finland
  // EU set we ship to
  DE: 19, // Germany
  NL: 21, // Netherlands
  BE: 21, // Belgium
  FR: 20, // France
  AT: 20, // Austria
  IT: 22, // Italy
  ES: 21, // Spain
  PT: 23, // Portugal
  IE: 23, // Ireland
  PL: 23, // Poland
  CZ: 21, // Czechia
  EE: 22, // Estonia
  LV: 21, // Latvia
  LT: 21, // Lithuania
  LU: 17, // Luxembourg
  SK: 23, // Slovakia
  SI: 22, // Slovenia
  HU: 27, // Hungary
  RO: 19, // Romania
  BG: 20, // Bulgaria
  HR: 25, // Croatia
  GR: 24, // Greece
  CY: 19, // Cyprus
  MT: 18, // Malta
};

/**
 * Standard rate for a destination country. Returns null for UNKNOWN / countries
 * not in the table so the caller can surface it rather than silently apply 0.
 */
export function standardRateFor(country: string): number | null {
  const rate = STANDARD_VAT_RATES[country];
  return rate === undefined ? null : rate;
}
