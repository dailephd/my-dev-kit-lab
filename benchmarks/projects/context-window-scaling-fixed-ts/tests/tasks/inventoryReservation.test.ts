import { describe, expect, it } from "vitest";
import { availableStock, releaseReservation, reserveStock } from "../../src/tasks/inventoryReservation.js";

describe("inventoryReservation", () => {
  it("reserves and releases stock without mutating the input", () => {
    const level = { sku: "sku-1", onHand: 10, reserved: 2 };
    const reserved = reserveStock(level, 3);
    expect(reserved.reserved).toBe(5);
    expect(level.reserved).toBe(2);
    expect(availableStock(releaseReservation(reserved, 5))).toBe(10);
  });

  it("rejects over-reservation and invalid quantities", () => {
    const level = { sku: "sku-1", onHand: 4, reserved: 1 };
    expect(() => reserveStock(level, 4)).toThrow("Insufficient stock");
    expect(() => reserveStock(level, 0)).toThrow("positive integer");
    expect(() => releaseReservation(level, 2)).toThrow("no larger");
  });
});
