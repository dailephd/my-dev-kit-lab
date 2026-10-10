import assert from "node:assert/strict";
import test from "node:test";
import { createInventorySystem } from "../src/index.js";

test("a duplicate reservation id does not consume stock twice", () => {
  const { store, service } = createInventorySystem();
  store.addStock("widget", 5);
  service.reserve({ reservationId: "r-1", sku: "widget", quantity: 2 });
  assert.throws(() => service.reserve({ reservationId: "r-1", sku: "widget", quantity: 2 }), {
    code: "DUPLICATE_RESERVATION"
  });
  assert.equal(store.getItem("widget").available, 3);
  assert.equal(store.listReservations().length, 1);
});

test("a duplicate id for another sku changes neither sku nor the original record", () => {
  const { store, service } = createInventorySystem();
  store.addStock("widget", 5);
  store.addStock("gadget", 5);
  service.reserve({ reservationId: "r-1", sku: "widget", quantity: 2 });
  assert.throws(() => service.reserve({ reservationId: "r-1", sku: "gadget", quantity: 4 }), {
    code: "DUPLICATE_RESERVATION"
  });
  assert.equal(store.getItem("gadget").available, 5);
  assert.equal(store.getItem("widget").available, 3);
  assert.deepEqual(store.getReservation("r-1"), { id: "r-1", sku: "widget", quantity: 2, status: "active" });
});

test("a failed reservation id can be used again by a later valid reservation", () => {
  const { store, service } = createInventorySystem();
  store.addStock("widget", 3);
  assert.throws(() => service.reserve({ reservationId: "r-9", sku: "widget", quantity: 99 }), {
    code: "INSUFFICIENT_STOCK"
  });
  service.reserve({ reservationId: "r-9", sku: "widget", quantity: 1 });
  assert.equal(store.getItem("widget").available, 2);
  assert.equal(store.listReservations().length, 1);
});

test("unrelated inventory items stay unchanged through failures and successes", () => {
  const { store, service } = createInventorySystem();
  store.addStock("widget", 4);
  store.addStock("gadget", 7);
  const gadgetBefore = store.getItem("gadget");
  assert.throws(() => service.reserve({ reservationId: "r-1", sku: "widget", quantity: 5 }), {
    code: "INSUFFICIENT_STOCK"
  });
  service.reserve({ reservationId: "r-2", sku: "widget", quantity: 4 });
  assert.deepEqual(store.getItem("gadget"), gadgetBefore);
  assert.equal(store.getItem("widget").available, 0);
});

test("stock never goes negative after repeated failing attempts", () => {
  const { store, service } = createInventorySystem();
  store.addStock("widget", 1);
  for (let attempt = 0; attempt < 3; attempt += 1) {
    assert.throws(() => service.reserve({ reservationId: `r-${attempt}`, sku: "widget", quantity: 2 }), {
      code: "INSUFFICIENT_STOCK"
    });
  }
  assert.equal(store.getItem("widget").available, 1);
  assert.deepEqual(store.listReservations(), []);
});
