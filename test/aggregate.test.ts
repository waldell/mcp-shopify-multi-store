import { describe, it, expect } from "vitest";
import { aggregateOrders } from "../src/lib/vat-underlag/index.js";
import type { StoreOrderData, RawOrder } from "../src/lib/vat-underlag/index.js";

function order(p: Partial<RawOrder>): RawOrder {
  return {
    id: p.id ?? "gid://shopify/Order/1",
    name: p.name ?? "#1001",
    createdAt: p.createdAt ?? "2026-05-01T10:00:00Z",
    test: p.test ?? false,
    displayFinancialStatus: p.displayFinancialStatus ?? "PAID",
    totalPrice: p.totalPrice ?? "0.00",
    currency: p.currency ?? "SEK",
    totalTax: p.totalTax ?? "0.00",
    totalRefunded: p.totalRefunded ?? "0.00",
    shipCountry: "shipCountry" in p ? (p.shipCountry ?? null) : "SE",
  };
}

describe("aggregateOrders", () => {
  it("groups by (store, shipCountry, currency) and carries both VAT columns", () => {
    const data: StoreOrderData[] = [
      {
        store: "Alpha",
        storeDomain: "alpha.myshopify.com",
        orders: [
          order({ totalPrice: "500.00", shipCountry: "SE" }),
          order({ totalPrice: "500.00", shipCountry: "SE", totalRefunded: "100.00" }),
          order({ totalPrice: "119.00", shipCountry: "DE" }),
        ],
      },
    ];
    const { rows } = aggregateOrders(data);
    expect(rows).toHaveLength(2);

    const se = rows.find((r) => r.shipCountry === "SE")!;
    expect(se.orderCount).toBe(2);
    expect(se.grossSales).toBe("1000.00");
    expect(se.refunds).toBe("100.00");
    expect(se.netSales).toBe("900.00");
    expect(se.vatCharged).toBe("0.00"); // actual VAT is 0
    expect(se.vatRate).toBe("25");
    expect(se.computedVatIfLiable).toBe("180.00"); // 900 * 25/125
    expect(se.netExVatIfLiable).toBe("720.00");

    const de = rows.find((r) => r.shipCountry === "DE")!;
    expect(de.vatRate).toBe("19");
    expect(de.computedVatIfLiable).toBe("19.00"); // 119 * 19/119
  });

  it("buckets null ship-country as UNKNOWN and surfaces a note, never rated", () => {
    const data: StoreOrderData[] = [
      {
        store: "Beta",
        storeDomain: "beta.myshopify.com",
        orders: [order({ totalPrice: "250.00", shipCountry: null })],
      },
    ];
    const { rows, notes } = aggregateOrders(data);
    const unknown = rows.find((r) => r.shipCountry === "UNKNOWN")!;
    expect(unknown).toBeDefined();
    expect(unknown.vatRate).toBe(""); // never silently apply a rate
    expect(unknown.computedVatIfLiable).toBe("0.00");
    expect(notes.some((n) => n.includes("UNKNOWN"))).toBe(true);
  });

  it("totalsByCurrency ties exactly to the sum of rounded rows; never crosses currency", () => {
    const data: StoreOrderData[] = [
      {
        store: "Gamma",
        storeDomain: "gamma.myshopify.com",
        orders: [
          order({ totalPrice: "100.00", currency: "SEK", shipCountry: "SE" }),
          order({ totalPrice: "200.00", currency: "DKK", shipCountry: "DK" }),
        ],
      },
    ];
    const { rows, totalsByCurrency } = aggregateOrders(data);
    expect(totalsByCurrency).toHaveLength(2);
    const sek = totalsByCurrency.find((t) => t.currency === "SEK")!;
    const dkk = totalsByCurrency.find((t) => t.currency === "DKK")!;
    expect(sek.netSales).toBe("100.00");
    expect(dkk.netSales).toBe("200.00");
    // sum of rounded row netSales equals the currency total
    const sekRowSum = rows
      .filter((r) => r.currency === "SEK")
      .reduce((a, r) => a + Number(r.netSales), 0);
    expect(sekRowSum.toFixed(2)).toBe(sek.netSales);
  });

  it("excludes test orders and honors financial-status allowlist", () => {
    const data: StoreOrderData[] = [
      {
        store: "Delta",
        storeDomain: "delta.myshopify.com",
        orders: [
          order({ totalPrice: "100.00", test: true }),
          order({ totalPrice: "100.00", displayFinancialStatus: "VOIDED" }),
          order({ totalPrice: "100.00", displayFinancialStatus: "PAID" }),
        ],
      },
    ];
    const { rows } = aggregateOrders(data, { includeFinancialStatuses: ["PAID"] });
    expect(rows).toHaveLength(1);
    expect(rows[0].orderCount).toBe(1);
    expect(rows[0].grossSales).toBe("100.00");
  });
});
