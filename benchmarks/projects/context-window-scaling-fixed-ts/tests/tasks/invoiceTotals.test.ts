import { describe, expect, it } from "vitest";
import { applyBulkDiscount, calculateInvoiceTotal } from "../../src/tasks/invoiceTotals.js";

describe("invoiceTotals", () => {
  it("applies tiered bulk discounts by quantity", () => {
    expect(applyBulkDiscount(1000, 19)).toBe(1000);
    expect(applyBulkDiscount(1000, 20)).toBe(950);
    expect(applyBulkDiscount(1000, 100)).toBe(900);
  });

  it("adds rounded tax after the discount", () => {
    expect(calculateInvoiceTotal([{ unitCents: 500, quantity: 2 }], 0.1)).toBe(1100);
  });
});
