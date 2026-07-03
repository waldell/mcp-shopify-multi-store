/**
 * Domain types for the VAT / payout reconciliation underlag.
 *
 * The "Raw*" types are the plain-data shape produced by the network fetch layer
 * (src/vat-fetch.ts). They contain ONLY strings/booleans — no Decimal, no Date —
 * so that this pure lib remains deterministic and network-free. All money is
 * carried as the original Shopify MoneyV2 `amount` string and parsed into Decimal
 * inside the lib.
 */

/** A Shopify MoneyV2 amount, kept as the raw decimal string (e.g. "1234.50"). */
export type MoneyString = string;

/** ISO 3166-1 alpha-2 country code, or the sentinel "UNKNOWN". */
export type CountryCode = string;

/** One order as fetched from the Admin API (test orders already excluded upstream). */
export interface RawOrder {
  id: string;
  name: string;
  createdAt: string; // ISO 8601
  test: boolean;
  displayFinancialStatus: string | null;
  /** Gross, incl. shipping, before refunds. */
  totalPrice: MoneyString;
  currency: string; // currencyCode from totalPriceSet.shopMoney
  /** Actual VAT charged — expected "0.00" for these non-IOSS stores. */
  totalTax: MoneyString;
  totalRefunded: MoneyString;
  /** Destination country (shippingAddress → billingAddress → null). */
  shipCountry: CountryCode | null;
}

/** The summary breakdown of a payout (all MoneyV2 amount strings). */
export interface RawPayoutSummary {
  chargesGross: MoneyString;
  chargesFee: MoneyString;
  refundsFeeGross: MoneyString;
  refundsFee: MoneyString;
  adjustmentsGross: MoneyString;
  adjustmentsFee: MoneyString;
  reservedFundsGross: MoneyString;
  reservedFundsFee: MoneyString;
  retriedPayoutsGross: MoneyString;
  retriedPayoutsFee: MoneyString;
}

/** One payout as fetched from shopifyPaymentsAccount.payouts. */
export interface RawPayout {
  id: string;
  issuedAt: string; // ISO 8601
  status: string;
  net: MoneyString;
  currency: string;
  summary: RawPayoutSummary;
}

/** Per-store fetch result for the payout side. */
export interface StorePayoutData {
  store: string;
  storeDomain: string;
  /** false when shopifyPaymentsAccount is null (e.g. paused store, no Payments). */
  hasPaymentsAccount: boolean;
  payouts: RawPayout[];
}

/** Per-store fetch result for the sales side. */
export interface StoreOrderData {
  store: string;
  storeDomain: string;
  orders: RawOrder[];
}

// ---------------------------------------------------------------------------
// Output row shapes (decimal strings, ISO codes)
// ---------------------------------------------------------------------------

/** One aggregated VAT underlag row per (store, shipCountry, currency) group. */
export interface VatRow {
  store: string;
  storeDomain: string;
  shipCountry: CountryCode;
  currency: string;
  orderCount: number;
  grossSales: string;
  refunds: string;
  netSales: string;
  vatCharged: string;
  vatRate: string; // percent, e.g. "25"
  computedVatIfLiable: string;
  netExVatIfLiable: string;
}

/** Per-currency totals (never summed across currencies). */
export interface CurrencyTotals {
  currency: string;
  orderCount: number;
  grossSales: string;
  refunds: string;
  netSales: string;
  vatCharged: string;
  computedVatIfLiable: string;
  netExVatIfLiable: string;
}

export interface VatReport {
  generatedAt: string; // injectable — never Date.now()
  period: { start: string; end: string };
  dateBasis: string;
  vatComputation: "inclusive";
  fxConversion: "none";
  scope: {
    testExcluded: true;
    financialStatusFilter: string;
    refundAttribution: string;
  };
  rows: VatRow[];
  totalsByCurrency: CurrencyTotals[];
  notes: string[];
}

/** One normalized payout row — this is what matches the bank. */
export interface NormalizedPayout {
  store: string;
  storeDomain: string;
  payoutId: string;
  issuedAt: string; // date portion (YYYY-MM-DD) in report TZ
  issuedAtRaw: string; // original ISO timestamp
  status: string;
  currency: string;
  net: string;
  feeTotal: string;
  grossTotal: string;
}

/** A parsed row from the bank (Nordea) CSV export. */
export interface BankRow {
  date: string; // YYYY-MM-DD (already normalized to report TZ / as given)
  amount: string; // decimal string, full öre precision
  currency: string;
  descriptor: string;
  raw: string; // original line, for the audit trail
}

/** A reconciled bank↔payout pairing. */
export interface ReconciledRow {
  store: string;
  currency: string;
  date: string;
  amount: string;
  payoutId: string;
  bankDescriptor: string;
}

/** An unreconciled group pushed to the review list. */
export interface AttGranskaRow {
  currency: string;
  date: string;
  amount: string;
  bankCount: number;
  payoutCount: number;
  reason: string;
  payoutIds: string[];
  bankDescriptors: string[];
}

export interface ReconciliationReport {
  generatedAt: string;
  period: { start: string; end: string };
  timezone: string;
  matching: string;
  reconciled: ReconciledRow[];
  att_granska: AttGranskaRow[];
  notes: string[];
}
