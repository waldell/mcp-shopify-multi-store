/**
 * Pure, deterministic VAT / payout reconciliation library.
 *
 * NO network, NO clock reads. `generatedAt` is always injected by the caller so
 * that identical inputs produce byte-identical outputs. Both the MCP tools
 * (src/index.ts) and the CLI (scripts/vat-underlag.ts) import from here.
 */
export * from "./types.js";
export { dec, money, sum, Decimal } from "./money.js";
export { STANDARD_VAT_RATES, standardRateFor } from "./rates.js";
export { computeVatInclusive } from "./vat.js";
export { zonedDate, DEFAULT_TIMEZONE } from "./datetime.js";
export {
  aggregateOrders,
  resolveShipCountry,
  UNKNOWN_COUNTRY,
  type AggregateOptions,
  type AggregateResult,
} from "./aggregate.js";
export { normalizePayouts } from "./payouts.js";
export { reconcile, type ReconcileResult } from "./reconcile.js";
export { parseBankCsv, parseBankAmount, type BankCsvOptions } from "./bank-csv.js";
export {
  buildVatReport,
  buildReconciliationReport,
  type BuildVatReportInput,
  type BuildReconciliationInput,
} from "./report.js";
export {
  vatReportToCsv,
  totalsByCurrencyToCsv,
  reconciledToCsv,
  attGranskaToCsv,
  type CsvOptions,
} from "./csv.js";
