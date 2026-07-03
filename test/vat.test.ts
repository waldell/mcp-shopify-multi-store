import { describe, it, expect } from "vitest";
import {
  computeVatInclusive,
  dec,
  money,
} from "../src/lib/vat-underlag/index.js";

describe("VAT-inclusive extraction math", () => {
  it("extracts 25% from a round amount", () => {
    const { vat, exVat } = computeVatInclusive(dec("1000.00"), 25);
    expect(money(vat)).toBe("200.00"); // 1000 * 25/125
    expect(money(exVat)).toBe("800.00");
  });

  it("extracts 19% with half-up rounding at öre", () => {
    const { vat, exVat } = computeVatInclusive(dec("100.00"), 19);
    // 100 * 19/119 = 15.9663... → 15.97 half-up
    expect(money(vat)).toBe("15.97");
    expect(money(exVat)).toBe("84.03");
  });

  it("rounds öre half-up (25% on 12.34)", () => {
    const { vat } = computeVatInclusive(dec("12.34"), 25);
    // 12.34 * 25/125 = 2.468 → 2.47
    expect(money(vat)).toBe("2.47");
  });

  it("handles tiny amounts (25% on 0.10)", () => {
    const { vat, exVat } = computeVatInclusive(dec("0.10"), 25);
    expect(money(vat)).toBe("0.02"); // 0.02
    expect(money(exVat)).toBe("0.08");
  });

  it("vat + exVat always equals net after rounding within one öre", () => {
    const net = dec("999.99");
    const { vat, exVat } = computeVatInclusive(net, 25);
    expect(money(vat.plus(exVat))).toBe("999.99");
  });
});
