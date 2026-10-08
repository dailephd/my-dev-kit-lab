import assert from "node:assert/strict";
import test from "node:test";
import { INVALID_QUANTITY, QuantityError, assertPositiveInteger, createInventorySystem } from "../src/index.js";

function isQuantityError(error) {
  return error instanceof QuantityError && error.code === INVALID_QUANTITY;
}

test("non-finite and not-a-number values are rejected", () => {
  for (const value of [Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY]) {
    assert.throws(() => assertPositiveInteger(value), isQuantityError);
  }
});

test("values that only look like zero or a whole number are rejected", () => {
  for (const value of [-0, 0.1, 1e-9, Number.EPSILON, 0.999999, 2.000001]) {
    assert.throws(() => assertPositiveInteger(value), isQuantityError);
  }
});

test("nonnumeric values are rejected", () => {
  for (const value of ["3", "", " ", null, undefined, {}, [], [3], true, 3n, () => 3]) {
    assert.throws(() => assertPositiveInteger(value), isQuantityError);
  }
});

test("positive integers are accepted and returned unchanged", () => {
  for (const value of [1, 2, 10, 1000, Number.MAX_SAFE_INTEGER]) {
    assert.equal(assertPositiveInteger(value), value);
  }
});

test("rejected stock additions never mutate inventory", () => {
  const { store } = createInventorySystem();
  store.addStock("gadget", 2);
  for (const quantity of [Number.NaN, Number.POSITIVE_INFINITY, -0, "4", null]) {
    assert.throws(() => store.addStock("gadget", quantity), isQuantityError);
    assert.throws(() => store.addStock("fresh", quantity), isQuantityError);
  }
  assert.deepEqual(store.listItems(), [{ sku: "gadget", available: 2, received: 2 }]);
});

test("rejected reservations never mutate inventory or reservation records", () => {
  const { store, service } = createInventorySystem();
  store.addStock("gadget", 4);
  for (const quantity of [Number.NaN, Number.POSITIVE_INFINITY, -0, 0.25, "2"]) {
    assert.throws(() => service.reserve({ reservationId: "r-edge", sku: "gadget", quantity }), isQuantityError);
  }
  assert.equal(store.getItem("gadget").available, 4);
  assert.equal(store.getReservation("r-edge"), null);
});
