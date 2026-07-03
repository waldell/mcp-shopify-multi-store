/**
 * Payout normalization: raw Shopify payout → one normalized row that matches the
 * bank statement. Pure and deterministic.
 *
 * feeTotal and grossTotal are derived from the summary breakdown:
 *   grossTotal = Σ gross of every transaction type
 *   feeTotal   = Σ fee of every transaction type
 * `net` is taken directly from the payout (authoritative bank figure) and, for a
 * consistent payout, equals grossTotal + feeTotal (fees are negative).
 */
import { dec, money, Decimal } from "./money.js";
import { zonedDate } from "./datetime.js";
import type {
  StorePayoutData,
  RawPayout,
  NormalizedPayout,
} from "./types.js";

function grossOf(p: RawPayout): Decimal {
  const s = p.summary;
  return dec(s.chargesGross)
    .plus(dec(s.refundsFeeGross))
    .plus(dec(s.adjustmentsGross))
    .plus(dec(s.reservedFundsGross))
    .plus(dec(s.retriedPayoutsGross));
}

function feeOf(p: RawPayout): Decimal {
  const s = p.summary;
  return dec(s.chargesFee)
    .plus(dec(s.refundsFee))
    .plus(dec(s.adjustmentsFee))
    .plus(dec(s.reservedFundsFee))
    .plus(dec(s.retriedPayoutsFee));
}

export function normalizePayouts(
  stores: StorePayoutData[],
  timeZone: string
): NormalizedPayout[] {
  const rows: NormalizedPayout[] = [];
  for (const s of stores) {
    for (const p of s.payouts) {
      rows.push({
        store: s.store,
        storeDomain: s.storeDomain,
        payoutId: p.id,
        issuedAt: zonedDate(p.issuedAt, timeZone),
        issuedAtRaw: p.issuedAt,
        status: p.status,
        currency: p.currency,
        net: money(dec(p.net)),
        feeTotal: money(feeOf(p)),
        grossTotal: money(grossOf(p)),
      });
    }
  }
  // Deterministic sort: store, issuedAt, payoutId.
  rows.sort(
    (a, b) =>
      a.store.localeCompare(b.store) ||
      a.issuedAt.localeCompare(b.issuedAt) ||
      a.payoutId.localeCompare(b.payoutId)
  );
  return rows;
}
