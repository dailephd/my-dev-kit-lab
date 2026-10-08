import { RESERVATION_FULFILLED } from "./inventoryStore.js";

function bucket(reservations) {
  return {
    count: reservations.length,
    quantity: reservations.reduce((sum, reservation) => sum + reservation.quantity, 0)
  };
}

/**
 * Builds a deterministic fulfillment report: one row per sku (sorted by sku) and totals across rows.
 * For every row, received = available + active.quantity + fulfilled.quantity.
 */
export function buildFulfillmentReport(store) {
  const reservations = store.listReservations();
  const rows = store.listItems().map((item) => {
    const mine = reservations.filter((reservation) => reservation.sku === item.sku);
    return {
      sku: item.sku,
      received: item.received,
      available: item.available,
      active: bucket(mine.filter((reservation) => reservation.status !== RESERVATION_FULFILLED)),
      fulfilled: bucket(mine.filter((reservation) => reservation.status === RESERVATION_FULFILLED)),
      cancelled: bucket([])
    };
  });
  const sum = (selector) => rows.reduce((total, row) => total + selector(row), 0);
  return {
    skus: rows,
    totals: {
      received: sum((row) => row.received),
      available: sum((row) => row.available),
      active: sum((row) => row.active.quantity),
      fulfilled: sum((row) => row.fulfilled.quantity),
      cancelled: sum((row) => row.cancelled.quantity)
    }
  };
}
