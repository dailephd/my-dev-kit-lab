import assert from "node:assert/strict";
import test from "node:test";
import { INVALID_QUANTITY, QuantityError, createInventorySystem } from "../src/index.js";

function isQuantityError(error) {
  return error instanceof QuantityError && error.code === INVALID_QUANTITY;
}

test("zero is not a valid stock quantity and creates no item", () => {
  const { store } = createInventorySystem();
  assert.throws(() => store.addStock("widget", 0), isQuantityError);
  assert.equal(store.getItem("widget"), null);
  assert.deepEqual(store.listItems(), []);
});

test("negative and fractional quantities are rejected before stock changes", () => {
  const { store } = createInventorySystem();
  store.addStock("widget", 5);
  for (const quantity of [-1, -5, 1.5, 0.5]) {
    assert.throws(() => store.addStock("widget", quantity), isQuantityError);
  }
  assert.deepEqual(store.getItem("widget"), { sku: "widget", available: 5, received: 5 });
});

test("invalid reservation quantities are rejected before inventory or reservations change", () => {
  const { store, service } = createInventorySystem();
  store.addStock("widget", 5);
  for (const quantity of [0, -1, 2.5]) {
    assert.throws(
      () => service.reserve({ reservationId: `r-${String(quantity)}`, sku: "widget", quantity }),
      isQuantityError
    );
  }
  assert.deepEqual(store.getItem("widget"), { sku: "widget", available: 5, received: 5 });
  assert.deepEqual(store.listReservations(), []);
});

test("valid positive quantities keep working", () => {
  const { store, service } = createInventorySystem();
  store.addStock("widget", 3);
  store.addStock("widget", 2);
  assert.equal(store.getItem("widget").available, 5);
  const reservation = service.reserve({ reservationId: "r-1", sku: "widget", quantity: 4 });
  assert.equal(reservation.quantity, 4);
  assert.equal(store.getItem("widget").available, 1);
});
