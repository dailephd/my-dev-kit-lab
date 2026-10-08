import assert from "node:assert/strict";
import test from "node:test";
import { RESERVATION_ACTIVE, RESERVATION_CANCELLED, RESERVATION_FULFILLED, createInventorySystem } from "../src/index.js";

test("repeated cancellation does not restore stock again", () => {
  const { store, service } = createInventorySystem();
  store.addStock("widget", 10);
  service.reserve({ reservationId: "r-1", sku: "widget", quantity: 4 });
  service.cancel("r-1");
  service.cancel("r-1");
  service.cancel("r-1");
  assert.equal(store.getItem("widget").available, 10);
  assert.equal(store.getReservation("r-1").status, RESERVATION_CANCELLED);
});

test("a fulfilled reservation cannot be cancelled back into stock", () => {
  const { store, service } = createInventorySystem();
  store.addStock("widget", 10);
  service.reserve({ reservationId: "r-1", sku: "widget", quantity: 4 });
  service.fulfill("r-1");
  try {
    service.cancel("r-1");
  } catch {
    // Rejecting the transition is acceptable; restoring stock is not.
  }
  assert.equal(store.getItem("widget").available, 6);
  assert.equal(store.getReservation("r-1").status, RESERVATION_FULFILLED);
});

test("a cancelled reservation cannot be fulfilled", () => {
  const { store, service, report } = createInventorySystem();
  store.addStock("widget", 10);
  service.reserve({ reservationId: "r-1", sku: "widget", quantity: 4 });
  service.cancel("r-1");
  try {
    service.fulfill("r-1");
  } catch {
    // Rejecting the transition is acceptable; reporting it as fulfilled is not.
  }
  assert.equal(store.getReservation("r-1").status, RESERVATION_CANCELLED);
  assert.deepEqual(report().skus[0].fulfilled, { count: 0, quantity: 0 });
});

test("unknown reservations are rejected and change nothing", () => {
  const { store, service } = createInventorySystem();
  store.addStock("widget", 3);
  assert.throws(() => service.cancel("nope"), { code: "UNKNOWN_RESERVATION" });
  assert.throws(() => service.fulfill("nope"), { code: "UNKNOWN_RESERVATION" });
  assert.equal(store.getItem("widget").available, 3);
});

test("only the documented lifecycle states can be stored", () => {
  const { store, service } = createInventorySystem();
  store.addStock("widget", 3);
  service.reserve({ reservationId: "r-1", sku: "widget", quantity: 1 });
  for (const status of ["canceled", "complete", "", undefined, "ACTIVE"]) {
    assert.throws(() => store.setReservationStatus("r-1", status));
  }
  assert.equal(store.getReservation("r-1").status, RESERVATION_ACTIVE);
});

test("unrelated skus are unaffected by cancellation and fulfillment", () => {
  const { store, service, report } = createInventorySystem();
  store.addStock("widget", 10);
  store.addStock("gadget", 6);
  service.reserve({ reservationId: "r-1", sku: "widget", quantity: 4 });
  service.reserve({ reservationId: "r-2", sku: "gadget", quantity: 2 });
  const gadgetBefore = report().skus.find((row) => row.sku === "gadget");
  service.cancel("r-1");
  service.cancel("r-1");
  const gadgetAfter = report().skus.find((row) => row.sku === "gadget");
  assert.deepEqual(gadgetAfter, gadgetBefore);
  assert.deepEqual(gadgetAfter.active, { count: 1, quantity: 2 });
});

test("the report is deterministic and sorted by sku regardless of insertion order", () => {
  const build = (order) => {
    const { store, service, report } = createInventorySystem();
    for (const sku of order) {
      store.addStock(sku, 5);
    }
    service.reserve({ reservationId: "r-1", sku: "b-item", quantity: 2 });
    service.reserve({ reservationId: "r-2", sku: "a-item", quantity: 1 });
    service.cancel("r-2");
    return report();
  };
  const first = build(["b-item", "a-item", "c-item"]);
  const second = build(["c-item", "a-item", "b-item"]);
  assert.deepEqual(first, second);
  assert.deepEqual(
    first.skus.map((row) => row.sku),
    ["a-item", "b-item", "c-item"]
  );
  assert.deepEqual(first, build(["b-item", "a-item", "c-item"]));
});

test("every row keeps received equal to available plus active plus fulfilled quantity", () => {
  const { store, service, report } = createInventorySystem();
  store.addStock("widget", 9);
  service.reserve({ reservationId: "r-1", sku: "widget", quantity: 2 });
  service.reserve({ reservationId: "r-2", sku: "widget", quantity: 3 });
  service.reserve({ reservationId: "r-3", sku: "widget", quantity: 1 });
  service.cancel("r-1");
  service.cancel("r-1");
  service.fulfill("r-2");
  for (const row of report().skus) {
    assert.equal(row.received, row.available + row.active.quantity + row.fulfilled.quantity);
  }
});
