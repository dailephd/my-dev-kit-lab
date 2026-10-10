import assert from "node:assert/strict";
import test from "node:test";
import { createInventorySystem } from "../src/index.js";

test("the report distinguishes active, fulfilled and cancelled reservations", () => {
  const { store, service, report } = createInventorySystem();
  store.addStock("widget", 10);
  service.reserve({ reservationId: "r-1", sku: "widget", quantity: 3 });
  service.reserve({ reservationId: "r-2", sku: "widget", quantity: 2 });
  service.reserve({ reservationId: "r-3", sku: "widget", quantity: 1 });
  service.cancel("r-1");
  service.fulfill("r-2");
  const [row] = report().skus;
  assert.equal(row.sku, "widget");
  assert.deepEqual(row.active, { count: 1, quantity: 1 });
  assert.deepEqual(row.fulfilled, { count: 1, quantity: 2 });
  assert.deepEqual(row.cancelled, { count: 1, quantity: 3 });
});

test("cancellation restores exactly the reserved quantity", () => {
  const { store, service } = createInventorySystem();
  store.addStock("widget", 10);
  service.reserve({ reservationId: "r-1", sku: "widget", quantity: 4 });
  assert.equal(store.getItem("widget").available, 6);
  const cancelled = service.cancel("r-1");
  assert.equal(cancelled.status, "cancelled");
  assert.equal(store.getItem("widget").available, 10);
});

test("reported totals agree with the underlying store", () => {
  const { store, service, report } = createInventorySystem();
  store.addStock("widget", 10);
  store.addStock("gadget", 6);
  service.reserve({ reservationId: "r-1", sku: "widget", quantity: 3 });
  service.reserve({ reservationId: "r-2", sku: "gadget", quantity: 2 });
  service.reserve({ reservationId: "r-3", sku: "gadget", quantity: 1 });
  service.cancel("r-1");
  service.fulfill("r-2");
  const result = report();
  for (const row of result.skus) {
    const item = store.getItem(row.sku);
    assert.equal(row.available, item.available);
    assert.equal(row.received, item.received);
    assert.equal(row.received, row.available + row.active.quantity + row.fulfilled.quantity);
  }
  assert.deepEqual(result.totals, { received: 16, available: 13, active: 1, fulfilled: 2, cancelled: 3 });
});
