/**
 * CSV serialization for the two artifacts. Pure and deterministic.
 *
 * By default numbers are emitted with a dot decimal separator. Pass
 * `decimalComma: true` for Swedish formatting (comma decimal) — in that mode the
 * field delimiter switches to ';' so the comma-decimals don't collide with it.
 */
import type {
  VatReport,
  ReconciliationReport,
  VatRow,
  CurrencyTotals,
} from "./types.js";

export interface CsvOptions {
  decimalComma?: boolean;
}

const NUMERIC_STRING = /^-?\d+\.\d+$/;

function delim(opts: CsvOptions): string {
  return opts.decimalComma ? ";" : ",";
}

/** Format a single cell: apply decimal-comma to numeric strings, then quote. */
function cell(value: string | number, opts: CsvOptions, d: string): string {
  let s = String(value);
  if (opts.decimalComma && typeof value === "string" && NUMERIC_STRING.test(value)) {
    s = value.replace(".", ",");
  }
  if (s.includes(d) || s.includes('"') || s.includes("\n")) {
    return `"${s.replace(/"/g, '""')}"`;
  }
  return s;
}

function toCsv(
  headers: string[],
  rows: (string | number)[][],
  opts: CsvOptions
): string {
  const d = delim(opts);
  const lines = [
    headers.map((h) => cell(h, { decimalComma: false }, d)).join(d),
    ...rows.map((r) => r.map((c) => cell(c, opts, d)).join(d)),
  ];
  return lines.join("\n") + "\n";
}

const VAT_HEADERS = [
  "store",
  "storeDomain",
  "shipCountry",
  "currency",
  "orderCount",
  "grossSales",
  "refunds",
  "netSales",
  "vatCharged",
  "vatRate",
  "computedVatIfLiable",
  "netExVatIfLiable",
];

function vatRowCells(r: VatRow): (string | number)[] {
  return [
    r.store,
    r.storeDomain,
    r.shipCountry,
    r.currency,
    r.orderCount,
    r.grossSales,
    r.refunds,
    r.netSales,
    r.vatCharged,
    r.vatRate,
    r.computedVatIfLiable,
    r.netExVatIfLiable,
  ];
}

/** VAT underlag → CSV (the row-level field dictionary). */
export function vatReportToCsv(report: VatReport, opts: CsvOptions = {}): string {
  return toCsv(VAT_HEADERS, report.rows.map(vatRowCells), opts);
}

/** Per-currency totals → CSV (companion file, never summed across currencies). */
export function totalsByCurrencyToCsv(
  totals: CurrencyTotals[],
  opts: CsvOptions = {}
): string {
  const headers = [
    "currency",
    "orderCount",
    "grossSales",
    "refunds",
    "netSales",
    "vatCharged",
    "computedVatIfLiable",
    "netExVatIfLiable",
  ];
  const rows = totals.map((t) => [
    t.currency,
    t.orderCount,
    t.grossSales,
    t.refunds,
    t.netSales,
    t.vatCharged,
    t.computedVatIfLiable,
    t.netExVatIfLiable,
  ]);
  return toCsv(headers, rows, opts);
}

/** Reconciled bank↔payout rows → CSV. */
export function reconciledToCsv(
  report: ReconciliationReport,
  opts: CsvOptions = {}
): string {
  const headers = [
    "store",
    "currency",
    "date",
    "amount",
    "payoutId",
    "bankDescriptor",
  ];
  const rows = report.reconciled.map((r) => [
    r.store,
    r.currency,
    r.date,
    r.amount,
    r.payoutId,
    r.bankDescriptor,
  ]);
  return toCsv(headers, rows, opts);
}

/** att_granska review list → CSV. */
export function attGranskaToCsv(
  report: ReconciliationReport,
  opts: CsvOptions = {}
): string {
  const headers = [
    "currency",
    "date",
    "amount",
    "bankCount",
    "payoutCount",
    "reason",
    "payoutIds",
    "bankDescriptors",
  ];
  const rows = report.att_granska.map((r) => [
    r.currency,
    r.date,
    r.amount,
    r.bankCount,
    r.payoutCount,
    r.reason,
    r.payoutIds.join(" | "),
    r.bankDescriptors.join(" | "),
  ]);
  return toCsv(headers, rows, opts);
}
