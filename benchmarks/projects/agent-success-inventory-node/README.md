# agent-success-inventory-node

A small, dependency-free, in-memory inventory and reservation system written as JavaScript ES modules for
Node.js `>=24`.

This project is an **implementation benchmark** for the `agent-success-rate` experiment of
`my-dev-kit-lab`. It is a controlled fixture: the Lab copies it into a disposable sandbox, asks an
implementation to change code under `src/`, and judges the result with trusted checks that the
implementation does not receive. The project is not a product and has no database, network access,
environment dependence, randomness or timestamps.

## Behavior

The system models stock, reservations against that stock, and a fulfillment report. All state lives in
memory inside one system instance; two systems never share state.

- An item is identified by its `sku` and tracks `received` (all stock ever added) and `available` (stock not
  held by a reservation or consumed by a fulfilled reservation).
- A **quantity** for stock or for a reservation must be a positive integer. Zero, negative numbers,
  fractions, `NaN`, infinities and non-number values are rejected with a `QuantityError` whose `code` is
  `INVALID_QUANTITY`. Rejection happens before any stock or reservation changes.
- A **reservation** has an `id` supplied by the caller, a `sku`, a `quantity` and a `status`, which is one of
  `active`, `fulfilled` or `cancelled`.
  - Reserving moves the quantity out of `available` exactly once and records an `active` reservation.
  - A reservation that cannot be completed (unknown sku, insufficient stock, duplicate id) fails with a
    stable error `code` (`UNKNOWN_SKU`, `INSUFFICIENT_STOCK`, `DUPLICATE_RESERVATION`) and leaves stock and
    reservation records exactly as they were. A reservation id that never produced a record may be used
    again.
  - Cancelling an `active` reservation returns its quantity to `available` and marks it `cancelled`. Cancelling
    an already cancelled reservation changes nothing. A reservation in another terminal state is not
    restored (`INVALID_TRANSITION`).
  - Fulfilling an `active` reservation marks it `fulfilled`; its stock stays consumed.
- The **fulfillment report** has one row per sku, sorted by sku, plus totals. Each row reports `received`,
  `available` and `active`, `fulfilled` and `cancelled` buckets of `{ count, quantity }`. Reported figures
  agree with the store, and `received = available + active.quantity + fulfilled.quantity` holds for every
  row. The report is deterministic.

## Public API

Everything is exported from `src/index.js`.

| Export | Purpose |
| --- | --- |
| `createInventorySystem()` | Returns `{ store, service, report }` for a fresh, independent system. |
| `InventoryStore` | `addStock`, `getItem`, `listItems`, `takeStock`, `returnStock`, `addReservation`, `getReservation`, `listReservations`, `setReservationStatus`. |
| `ReservationService` | `reserve({ reservationId, sku, quantity })`, `cancel(id)`, `fulfill(id)`. |
| `buildFulfillmentReport(store)` | Returns `{ skus, totals }`. |
| `assertPositiveInteger(value)` | Returns the quantity or throws `QuantityError`. |
| `RESERVATION_ACTIVE`, `RESERVATION_FULFILLED`, `RESERVATION_CANCELLED` | Reservation status values. |
| `QuantityError`, `UnknownSkuError`, `InsufficientStockError`, `UnknownReservationError`, `DuplicateReservationError` | Error classes with a stable `code` property. |

Stores return copies of items and reservations, so changing a returned object never changes the system.

## Layout

```
src/quantity.js            quantity contract
src/inventoryStore.js      in-memory stock and reservation storage
src/reservationService.js  reserve, cancel and fulfill
src/fulfillmentReport.js   deterministic fulfillment report
src/index.js               public exports and createInventorySystem()
tests/*.check.mjs          trusted verification checks (owned by the Lab verifier)
```

## Running checks

```
npm test
node --test tests/regression.check.mjs
```

The files under `tests/` are named `*.check.mjs` on purpose and are run explicitly through Node's built-in
test runner. They are verification inputs owned by the Lab, not part of the implementation to change.
No installation step is needed.
