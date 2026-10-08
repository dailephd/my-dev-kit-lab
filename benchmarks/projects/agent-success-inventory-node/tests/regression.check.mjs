import assert from "node:assert/strict";
import test from "node:test";
import {
  InventoryStore,
  QuantityError,
  RESERVATION_ACTIVE,
  RESERVATION_FULFILLED,
  createInventorySystem
} from "../src/index.js";

test("addStock accumulates per sku and tracks received stock", () => {
  const { store } = createInventorySystem();
  store.addStock("widget", 3);
  store.addStock("widget", 4);
  store.addStock("gadget", 1);
  assert.deepEqual(store.getItem("widget"), { sku: "widget", available: 7, received: 7 });
  assert.deepEqual(
    store.listItems().map((item) => item.sku),
    ["gadget", "widget"]
  );
  assert.equal(store.getItem("missing"), null);
});

test("a valid reservation holds stock and records an active reservation", () => {
  const { store, service } = createInventorySystem();
  store.addStock("widget", 5);
  const reservation = service.reserve({ reservationId: "r-1", sku: "widget", quantity: 2 });
  assert.deepEqual(reservation, { id: "r-1", sku: "widget", quantity: 2, status: RESERVATION_ACTIVE });
  assert.deepEqual(store.getItem("widget"), { sku: "widget", available: 3, received: 5 });
});

test("quantities given as strings or other non-numbers are rejected", () => {
  const { store, service } = createInventorySystem();
  store.addStock("widget", 5);
  assert.throws(() => store.addStock("widget", "2"), QuantityError);
  assert.throws(() => service.reserve({ reservationId: "r-1", sku: "widget", quantity: "2" }), QuantityError);
  assert.throws(() => service.reserve({ reservationId: "r-1", sku: "widget", quantity: undefined }), QuantityError);
  assert.equal(store.getItem("widget").available, 5);
});

test("negative quantities are rejected", () => {
  const { store } = createInventorySystem();
  assert.throws(() => store.addStock("widget", -3), { code: "INVALID_QUANTITY" });
});

test("reserving an unknown sku fails with the unknown-sku error", () => {
  const { service } = createInventorySystem();
  assert.throws(() => service.reserve({ reservationId: "r-1", sku: "missing", quantity: 1 }), {
    code: "UNKNOWN_SKU"
  });
});

test("fulfilling an active reservation keeps its stock consumed", () => {
  const { store, service } = createInventorySystem();
  store.addStock("widget", 5);
  service.reserve({ reservationId: "r-1", sku: "widget", quantity: 2 });
  const fulfilled = service.fulfill("r-1");
  assert.equal(fulfilled.status, RESERVATION_FULFILLED);
  assert.equal(store.getItem("widget").available, 3);
});

test("cancelling an active reservation restores its stock", () => {
  const { store, service } = createInventorySystem();
  store.addStock("widget", 5);
  service.reserve({ reservationId: "r-1", sku: "widget", quantity: 2 });
  service.cancel("r-1");
  assert.equal(store.getItem("widget").available, 5);
});

test("the report of an untouched inventory mirrors the stock", () => {
  const { store, report } = createInventorySystem();
  store.addStock("b-item", 2);
  store.addStock("a-item", 4);
  assert.deepEqual(report(), {
    skus: [
      {
        sku: "a-item",
        received: 4,
        available: 4,
        active: { count: 0, quantity: 0 },
        fulfilled: { count: 0, quantity: 0 },
        cancelled: { count: 0, quantity: 0 }
      },
      {
        sku: "b-item",
        received: 2,
        available: 2,
        active: { count: 0, quantity: 0 },
        fulfilled: { count: 0, quantity: 0 },
        cancelled: { count: 0, quantity: 0 }
      }
    ],
    totals: { received: 6, available: 6, active: 0, fulfilled: 0, cancelled: 0 }
  });
});

test("the report counts active and fulfilled reservations", () => {
  const { store, service, report } = createInventorySystem();
  store.addStock("widget", 10);
  service.reserve({ reservationId: "r-1", sku: "widget", quantity: 3 });
  service.reserve({ reservationId: "r-2", sku: "widget", quantity: 2 });
  service.fulfill("r-2");
  const [row] = report().skus;
  assert.deepEqual(row.active, { count: 1, quantity: 3 });
  assert.deepEqual(row.fulfilled, { count: 1, quantity: 2 });
  assert.equal(row.available, 5);
});

test("inventories are independent of each other", () => {
  const one = createInventorySystem();
  const two = createInventorySystem();
  one.store.addStock("widget", 2);
  assert.deepEqual(two.store.listItems(), []);
  assert.ok(new InventoryStore().listReservations().length === 0);
});
