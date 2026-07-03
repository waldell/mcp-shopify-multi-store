import { describe, it, expect } from "vitest";
import {
  buildVatReport,
  buildReconciliationReport,
  vatReportToCsv,
  reconciledToCsv,
  attGranskaToCsv,
} from "../src/lib/vat-underlag/index.js";
import type {
  StoreOrderData,
  StorePayoutData,
  BankRow,
} from "../src/lib/vat-underlag/index.js";

const GENERATED_AT = "2026-07-01T00:00:00.000Z";

const orderData: StoreOrderData[] = [
  {
    store: "Alpha",
    storeDomain: "alpha.myshopify.com",
    orders: [
      {
        id: "1",
        name: "#1001",
        createdAt: "2026-05-01T10:00:00Z",
        test: false,
        displayFinancialStatus: "PAID",
        totalPrice: "500.00",
        currency: "SEK",
        totalTax: "0.00",
        totalRefunded: "0.00",
        shipCountry: "SE",
      },
      {
        id: "2",
        name: "#1002",
        createdAt: "2026-05-02T10:00:00Z",
        test: false,
        displayFinancialStatus: "PAID",
        totalPrice: "119.00",
        currency: "SEK",
        totalTax: "0.00",
        totalRefunded: "0.00",
        shipCountry: "DE",
      },
    ],
  },
];

const payoutData: StorePayoutData[] = [
  {
    store: "Alpha",
    storeDomain: "alpha.myshopify.com",
    hasPaymentsAccount: true,
    payouts: [
      {
        id: "gid://shopify/ShopifyPaymentsPayout/1",
        issuedAt: "2026-06-29T12:00:00Z",
        status: "PAID",
        net: "4378.31",
        currency: "SEK",
        summary: {
          chargesGross: "4500.00",
          chargesFee: "-121.69",
          refundsFeeGross: "0.00",
          refundsFee: "0.00",
          adjustmentsGross: "0.00",
          adjustmentsFee: "0.00",
          reservedFundsGross: "0.00",
          reservedFundsFee: "0.00",
          retriedPayoutsGross: "0.00",
          retriedPayoutsFee: "0.00",
        },
      },
    ],
  },
];

const bankRows: BankRow[] = [
  {
    date: "2026-06-29",
    amount: "4378.31",
    currency: "SEK",
    descriptor: "STRIPE Shopi",
    raw: "",
  },
];

describe("determinism", () => {
  it("VAT report: identical inputs → byte-identical JSON (fixed generatedAt)", () => {
    const a = buildVatReport({
      generatedAt: GENERATED_AT,
      period: { start: "2026-04-01", end: "2026-06-30" },
      orderData,
    });
    const b = buildVatReport({
      generatedAt: GENERATED_AT,
      period: { start: "2026-04-01", end: "2026-06-30" },
      orderData,
    });
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
    expect(vatReportToCsv(a)).toBe(vatReportToCsv(b));
  });

  it("reconciliation report: identical inputs → byte-identical JSON + CSV", () => {
    const a = buildReconciliationReport({
      generatedAt: GENERATED_AT,
      period: { start: "2026-04-01", end: "2026-06-30" },
      payoutData,
      bankRows,
    });
    const b = buildReconciliationReport({
      generatedAt: GENERATED_AT,
      period: { start: "2026-04-01", end: "2026-06-30" },
      payoutData,
      bankRows,
    });
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
    expect(reconciledToCsv(a)).toBe(reconciledToCsv(b));
    expect(attGranskaToCsv(a)).toBe(attGranskaToCsv(b));
    // the payout reconciles against the bank row
    expect(a.reconciled).toHaveLength(1);
    expect(a.att_granska).toHaveLength(0);
  });

  it("decimal-comma CSV uses ';' delimiter and comma decimals", () => {
    const rep = buildVatReport({
      generatedAt: GENERATED_AT,
      period: { start: "2026-04-01", end: "2026-06-30" },
      orderData,
    });
    const csv = vatReportToCsv(rep, { decimalComma: true });
    expect(csv).toContain(";");
    expect(csv).toMatch(/500,00/); // grossSales with comma decimal
  });
});
