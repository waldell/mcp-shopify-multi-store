import { describe, it, expect } from "vitest";
import { parseBankCsv, parseBankAmount } from "../src/lib/vat-underlag/index.js";

describe("parseBankAmount", () => {
  it("parses Swedish space-thousands comma-decimal", () => {
    expect(parseBankAmount("5 370,35")!.toFixed(2)).toBe("5370.35");
    expect(parseBankAmount("-1 234,56")!.toFixed(2)).toBe("-1234.56");
  });
  it("parses dot format", () => {
    expect(parseBankAmount("5370.35")!.toFixed(2)).toBe("5370.35");
  });
  it("parses mixed thousands+decimal both ways", () => {
    expect(parseBankAmount("1.234,56")!.toFixed(2)).toBe("1234.56");
    expect(parseBankAmount("1,234.56")!.toFixed(2)).toBe("1234.56");
  });
  it("returns null for non-numbers", () => {
    expect(parseBankAmount("Betald")).toBeNull();
    expect(parseBankAmount("")).toBeNull();
  });
});

describe("parseBankCsv", () => {
  it("parses the Nordea eCom example row (comma-delimited, no currency column)", () => {
    const csv =
      '2026-06-29, Nordea eCom, "STRIPE Shopi", Stripe, 5 370,35, Betald';
    const rows = parseBankCsv(csv, { defaultCurrency: "SEK" });
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      date: "2026-06-29",
      amount: "5370.35",
      currency: "SEK",
      descriptor: "STRIPE Shopi",
    });
  });

  it("parses a semicolon-delimited export with a header", () => {
    const csv = [
      "Datum;Text;Belopp;Valuta",
      "2026-06-29;STRIPE Shopi;4 378,31;SEK",
      "2026-06-30;STRIPE Shopi;1 000,00;SEK",
    ].join("\n");
    const rows = parseBankCsv(csv, { defaultCurrency: "SEK" });
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({
      date: "2026-06-29",
      amount: "4378.31",
      currency: "SEK",
      descriptor: "STRIPE Shopi",
    });
    expect(rows[1].amount).toBe("1000.00");
  });

  it("skips rows without a parseable amount", () => {
    const csv = [
      "2026-06-29;STRIPE Shopi;4 378,31;SEK",
      "Ingående saldo;;;;",
    ].join("\n");
    const rows = parseBankCsv(csv, { defaultCurrency: "SEK" });
    expect(rows).toHaveLength(1);
  });
});
