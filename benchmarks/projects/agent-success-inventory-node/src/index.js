import { buildFulfillmentReport } from "./fulfillmentReport.js";
import { InventoryStore } from "./inventoryStore.js";
import { ReservationService } from "./reservationService.js";

export { buildFulfillmentReport } from "./fulfillmentReport.js";
export {
  DuplicateReservationError,
  InsufficientStockError,
  InventoryStore,
  RESERVATION_ACTIVE,
  RESERVATION_CANCELLED,
  RESERVATION_FULFILLED,
  UnknownReservationError,
  UnknownSkuError
} from "./inventoryStore.js";
export { INVALID_QUANTITY, QuantityError, assertPositiveInteger } from "./quantity.js";
export { ReservationService } from "./reservationService.js";

/**
 * Creates an independent in-memory inventory: a store, a reservation service over it, and a report helper.
 */
export function createInventorySystem() {
  const store = new InventoryStore();
  const service = new ReservationService(store);
  return { store, service, report: () => buildFulfillmentReport(store) };
}
