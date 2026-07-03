/**
 * Report assembly — combines the pure aggregation / normalization / reconcile
 * steps into the two deliverable report objects. Deterministic: `generatedAt`
 * is injected by the caller (never read from a clock here).
 */
import { aggregateOrders, type AggregateOptions } from "./aggregate.js";
import { normalizePayouts } from "./payouts.js";
import { reconcile } from "./reconcile.js";
import { DEFAULT_TIMEZONE } from "./datetime.js";
import type {
  StoreOrderData,
  StorePayoutData,
  BankRow,
  VatReport,
  ReconciliationReport,
} from "./types.js";

export interface BuildVatReportInput {
  generatedAt: string;
  period: { start: string; end: string };
  orderData: StoreOrderData[];
  /** Stores whose fan-out returned a null shopifyPaymentsAccount, for notes. */
  storesWithoutPayments?: string[];
  aggregate?: AggregateOptions;
  /** Documented knob: which timestamp the period/refunds are attributed to. */
  dateBasis?: string;
  refundAttribution?: string;
}

export function buildVatReport(input: BuildVatReportInput): VatReport {
  const agg = aggregateOrders(input.orderData, input.aggregate ?? {});

  const notes = [...agg.notes];
  const noPayments = (input.storesWithoutPayments ?? []).slice().sort();
  if (noPayments.length > 0) {
    notes.push(
      `No Shopify Payments account for: ${noPayments.join(
        ", "
      )} (paused store or Payments not enabled) — these contribute sales but no payouts.`
    );
  }

  return {
    generatedAt: input.generatedAt,
    period: input.period,
    dateBasis: input.dateBasis ?? "order.createdAt",
    vatComputation: "inclusive",
    fxConversion: "none",
    scope: {
      testExcluded: true,
      financialStatusFilter: agg.financialStatusFilter,
      refundAttribution:
        input.refundAttribution ??
        "refunds attributed to the order's createdAt period (v1 knob)",
    },
    rows: agg.rows,
    totalsByCurrency: agg.totalsByCurrency,
    notes,
  };
}

export interface BuildReconciliationInput {
  generatedAt: string;
  period: { start: string; end: string };
  payoutData: StorePayoutData[];
  bankRows: BankRow[];
  timezone?: string;
}

export function buildReconciliationReport(
  input: BuildReconciliationInput
): ReconciliationReport {
  const tz = input.timezone ?? DEFAULT_TIMEZONE;
  const normalized = normalizePayouts(input.payoutData, tz);
  const { reconciled, att_granska } = reconcile(input.bankRows, normalized);

  const notes: string[] = [];
  const noPayments = input.payoutData
    .filter((s) => !s.hasPaymentsAccount)
    .map((s) => s.store)
    .sort();
  if (noPayments.length > 0) {
    notes.push(
      `No Shopify Payments account for: ${noPayments.join(
        ", "
      )} — excluded from payout matching.`
    );
  }
  notes.push(
    `${reconciled.length} bank↔payout rows reconciled; ${att_granska.length} group(s) to review.`
  );

  return {
    generatedAt: input.generatedAt,
    period: input.period,
    timezone: tz,
    matching:
      "group match on (currency, date, net at full öre); N-vs-N reconciles, count mismatch → att_granska; never across currencies",
    reconciled,
    att_granska,
    notes,
  };
}
