import { describe, expect, it } from "vitest";
import { calculateShippingQuote, selectWeightBand } from "../../src/tasks/shippingQuote.js";

describe("shippingQuote", () => {
  it("selects the smallest band that holds the parcel", () => {
    expect(selectWeightBand(500).baseCents).toBe(450);
    expect(selectWeightBand(501).baseCents).toBe(900);
  });

  it("adds the zone surcharge to the band price", () => {
    expect(calculateShippingQuote({ weightGrams: 300, destinationZone: "domestic" })).toBe(450);
    expect(calculateShippingQuote({ weightGrams: 300, destinationZone: "international" })).toBe(1650);
  });

  it("rejects non-positive and oversize weights", () => {
    expect(() => selectWeightBand(0)).toThrow("positive");
    expect(() => selectWeightBand(10001)).toThrow("maximum");
  });
});
