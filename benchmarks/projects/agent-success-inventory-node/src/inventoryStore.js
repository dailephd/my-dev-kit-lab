import { assertPositiveInteger } from "./quantity.js";

export const RESERVATION_ACTIVE = "active";
export const RESERVATION_FULFILLED = "fulfilled";
export const RESERVATION_CANCELLED = "cancelled";

export class UnknownSkuError extends Error {
  constructor(sku) {
    super(`unknown sku: ${sku}`);
    this.name = "UnknownSkuError";
    this.code = "UNKNOWN_SKU";
  }
}

export class InsufficientStockError extends Error {
  constructor(sku) {
    super(`insufficient stock for sku: ${sku}`);
    this.name = "InsufficientStockError";
    this.code = "INSUFFICIENT_STOCK";
  }
}

export class UnknownReservationError extends Error {
  constructor(id) {
    super(`unknown reservation: ${id}`);
    this.name = "UnknownReservationError";
    this.code = "UNKNOWN_RESERVATION";
  }
}

export class DuplicateReservationError extends Error {
  constructor(id) {
    super(`duplicate reservation: ${id}`);
    this.name = "DuplicateReservationError";
    this.code = "DUPLICATE_RESERVATION";
  }
}

/**
 * In-memory inventory and reservation storage. Items and reservations are returned as copies.
 * Each item tracks `received` (all stock ever added) and `available` (stock not held by a reservation).
 */
export class InventoryStore {
  #items = new Map();
  #reservations = new Map();

  addStock(sku, quantity) {
    assertPositiveInteger(quantity);
    const item = this.#items.get(sku) ?? { sku, available: 0, received: 0 };
    item.available += quantity;
    item.received += quantity;
    this.#items.set(sku, item);
    return { ...item };
  }

  getItem(sku) {
    const item = this.#items.get(sku);
    return item ? { ...item } : null;
  }

  /** Items sorted by sku. */
  listItems() {
    return [...this.#items.values()]
      .sort((a, b) => (a.sku < b.sku ? -1 : a.sku > b.sku ? 1 : 0))
      .map((item) => ({ ...item }));
  }

  /** Removes stock from `available` for a reservation. */
  takeStock(sku, quantity) {
    const item = this.#items.get(sku);
    if (!item) {
      throw new UnknownSkuError(sku);
    }
    item.available -= quantity;
    if (item.available < 0) {
      throw new InsufficientStockError(sku);
    }
    return { ...item };
  }

  /** Returns stock to `available`. */
  returnStock(sku, quantity) {
    const item = this.#items.get(sku);
    if (!item) {
      throw new UnknownSkuError(sku);
    }
    item.available += quantity;
    return { ...item };
  }

  addReservation(record) {
    this.#reservations.set(record.id, { ...record });
    return { ...record };
  }

  getReservation(id) {
    const record = this.#reservations.get(id);
    return record ? { ...record } : null;
  }

  /** Reservations in the order they were recorded. */
  listReservations() {
    return [...this.#reservations.values()].map((record) => ({ ...record }));
  }

  setReservationStatus(id, status) {
    const record = this.#reservations.get(id);
    if (!record) {
      throw new UnknownReservationError(id);
    }
    record.status = status;
    return { ...record };
  }
}
