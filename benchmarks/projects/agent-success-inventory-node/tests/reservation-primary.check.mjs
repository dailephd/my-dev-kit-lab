import assert from "node:assert/strict";
import test from "node:test";
import { createInventorySystem } from "../src/index.js";

test("a reservation that exceeds stock fails without consuming any stock", () => {
  const { store, service } = createInventorySystem();
  store.addStock("widget", 5);
  assert.throws(() => service.reserve({ reservationId: "r-1", sku: "widget", quantity: 8 }), {
    code: "INSUFFICIENT_STOCK"
  });
  assert.equal(store.getItem("widget").available, 5);
});

test("a failed reservation leaves no reservation record", () => {
  const { store, service } = createInventorySystem();
  store.addStock("widget", 2);
  assert.throws(() => service.reserve({ reservationId: "r-1", sku: "widget", quantity: 3 }), {
    code: "INSUFFICIENT_STOCK"
  });
  assert.throws(() => service.reserve({ reservationId: "r-2", sku: "missing", quantity: 1 }), {
    code: "UNKNOWN_SKU"
  });
  assert.deepEqual(store.listReservations(), []);
});

test("a successful reservation decrements stock exactly once", () => {
  const { store, service } = createInventorySystem();
  store.addStock("widget", 5);
  const reservation = service.reserve({ reservationId: "r-1", sku: "widget", quantity: 3 });
  assert.deepEqual(reservation, { id: "r-1", sku: "widget", quantity: 3, status: "active" });
  assert.equal(store.getItem("widget").available, 2);
  assert.equal(store.listReservations().length, 1);
});

test("reserving exactly the available stock succeeds and leaves none", () => {
  const { store, service } = createInventorySystem();
  store.addStock("widget", 5);
  service.reserve({ reservationId: "r-1", sku: "widget", quantity: 5 });
  assert.equal(store.getItem("widget").available, 0);
  assert.throws(() => service.reserve({ reservationId: "r-2", sku: "widget", quantity: 1 }), {
    code: "INSUFFICIENT_STOCK"
  });
  assert.equal(store.getItem("widget").available, 0);
});
