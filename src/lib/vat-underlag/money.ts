/**
 * Money helpers. ALL monetary math in this lib goes through Decimal — never a
 * JS float. Shopify MoneyV2 `amount` strings are parsed with `dec()`, math is
 * done at full precision, and values are rounded to 2 dp HALF-UP only at the
 * moment of output via `money()`.
 */
import { Decimal } from "decimal.js";

// Half-up rounding at output, per spec. Set high precision for intermediate math.
Decimal.set({ precision: 40, rounding: Decimal.ROUND_HALF_UP });

/**
 * Parse a MoneyV2 `amount` string (or number) into Decimal.
 * Null/undefined/empty → 0 (Shopify omits some money fields as null).
 */
export function dec(amount: string | number | null | undefined): Decimal {
  if (amount === null || amount === undefined || amount === "") {
    return new Decimal(0);
  }
  return new Decimal(amount);
}

/** Round a Decimal to 2 dp half-up and emit as a fixed-2 decimal string. */
export function money(value: Decimal): string {
  return value.toDecimalPlaces(2, Decimal.ROUND_HALF_UP).toFixed(2);
}

/** Sum a list of Decimals at full precision (no intermediate rounding). */
export function sum(values: Decimal[]): Decimal {
  return values.reduce((acc, v) => acc.plus(v), new Decimal(0));
}

export { Decimal };
