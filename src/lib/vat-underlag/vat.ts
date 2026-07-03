/**
 * VAT-INCLUSIVE extraction math.
 *
 * These stores currently charge NO VAT (they are not IOSS-registered). This
 * function does NOT decide whether the sale is liable — that is the accountant's
 * call. It only computes what output VAT WOULD be *if* the sale were liable,
 * extracted from the gross price already charged (we cannot back-bill the
 * customer), so the accountant can include or exclude it openly.
 *
 *   vat   = net × rate / (100 + rate)     (VAT-inclusive)
 *   exVat = net − vat
 */
import { Decimal } from "./money.js";

export interface VatSplit {
  /** Output VAT extracted from the (VAT-inclusive) net amount. */
  vat: Decimal;
  /** Net excluding the extracted VAT. */
  exVat: Decimal;
}

/**
 * @param net      VAT-inclusive net sales amount (Decimal, full precision).
 * @param ratePct  Standard VAT rate as a percent number (e.g. 25 or 19).
 */
export function computeVatInclusive(net: Decimal, ratePct: number): VatSplit {
  const rate = new Decimal(ratePct);
  // vat = net * rate / (100 + rate)
  const vat = net.times(rate).dividedBy(rate.plus(100));
  const exVat = net.minus(vat);
  return { vat, exVat };
}
