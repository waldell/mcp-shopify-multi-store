import { describe, it, expect } from "vitest";
import { reconcile } from "../src/lib/vat-underlag/index.js";
import type {
  BankRow,
  NormalizedPayout,
} from "../src/lib/vat-underlag/index.js";

function bank(p: Partial<BankRow>): BankRow {
  return {
    date: p.date ?? "2026-06-29",
    amount: p.amount ?? "0.00",
    currency: p.currency ?? "SEK",
    descriptor: p.descriptor ?? "STRIPE Shopi",
    raw: p.raw ?? "",
  };
}

function payout(p: Partial<NormalizedPayout>): NormalizedPayout {
  return {
    store: p.store ?? "Alpha",
    storeDomain: p.storeDomain ?? "alpha.myshopify.com",
    payoutId: p.payoutId ?? "gid://shopify/ShopifyPaymentsPayout/1",
    issuedAt: p.issuedAt ?? "2026-06-29",
    issuedAtRaw: p.issuedAtRaw ?? "2026-06-29T00:00:00Z",
    status: p.status ?? "PAID",
    currency: p.currency ?? "SEK",
    net: p.net ?? "0.00",
    feeTotal: p.feeTotal ?? "0.00",
    grossTotal: p.grossTotal ?? "0.00",
  };
}

describe("reconcile", () => {
  it("reconciles N-vs-N duplicates on the same day without flagging", () => {
    // Two identical 4378.31 bank rows and two identical payouts, same day.
    const bankRows = [
      bank({ amount: "4378.31" }),
      bank({ amount: "4378.31" }),
    ];
    const payouts = [
      payout({ net: "4378.31", payoutId: "p1" }),
      payout({ net: "4378.31", payoutId: "p2" }),
    ];
    const { reconciled, att_granska } = reconcile(bankRows, payouts);
    expect(reconciled).toHaveLength(2);
    expect(att_granska).toHaveLength(0);
  });

  it("flags a count mismatch (2 bank vs 1 payout) as att_granska", () => {
    const bankRows = [bank({ amount: "5370.35" }), bank({ amount: "5370.35" })];
    const payouts = [payout({ net: "5370.35", payoutId: "p1" })];
    const { reconciled, att_granska } = reconcile(bankRows, payouts);
    expect(reconciled).toHaveLength(0);
    expect(att_granska).toHaveLength(1);
    expect(att_granska[0].bankCount).toBe(2);
    expect(att_granska[0].payoutCount).toBe(1);
    expect(att_granska[0].reason).toMatch(/dubbel|orelaterad/i);
  });

  it("never matches across currencies", () => {
    const bankRows = [bank({ amount: "1000.00", currency: "SEK" })];
    const payouts = [payout({ net: "1000.00", currency: "DKK" })];
    const { reconciled, att_granska } = reconcile(bankRows, payouts);
    expect(reconciled).toHaveLength(0);
    // one SEK group (bank only) + one DKK group (payout only) → two exceptions
    expect(att_granska).toHaveLength(2);
    const sek = att_granska.find((r) => r.currency === "SEK")!;
    const dkk = att_granska.find((r) => r.currency === "DKK")!;
    expect(sek.payoutCount).toBe(0);
    expect(dkk.bankCount).toBe(0);
  });

  it("matches full öre precision, not rounded krona", () => {
    const bankRows = [bank({ amount: "4378.31" })];
    const payouts = [payout({ net: "4378.30" })]; // 1 öre off
    const { reconciled, att_granska } = reconcile(bankRows, payouts);
    expect(reconciled).toHaveLength(0);
    expect(att_granska).toHaveLength(2); // distinct amount groups
  });
});
