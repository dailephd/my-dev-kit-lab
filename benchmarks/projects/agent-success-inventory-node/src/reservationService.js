import {
  RESERVATION_ACTIVE,
  RESERVATION_FULFILLED,
  UnknownReservationError
} from "./inventoryStore.js";
import { assertPositiveInteger } from "./quantity.js";

export class ReservationService {
  constructor(store) {
    this.store = store;
  }

  /**
   * Reserves `quantity` units of `sku` under a caller-supplied reservation id.
   */
  reserve({ reservationId, sku, quantity }) {
    assertPositiveInteger(quantity);
    this.store.addReservation({ id: reservationId, sku, quantity, status: RESERVATION_ACTIVE });
    this.store.takeStock(sku, quantity);
    return this.store.getReservation(reservationId);
  }

  /**
   * Cancels a reservation and returns its quantity to available stock.
   */
  cancel(reservationId) {
    const record = this.store.getReservation(reservationId);
    if (!record) {
      throw new UnknownReservationError(reservationId);
    }
    this.store.returnStock(record.sku, record.quantity);
    return this.store.setReservationStatus(reservationId, "canceled");
  }

  /**
   * Marks a reservation as fulfilled. Fulfilled stock stays consumed.
   */
  fulfill(reservationId) {
    const record = this.store.getReservation(reservationId);
    if (!record) {
      throw new UnknownReservationError(reservationId);
    }
    return this.store.setReservationStatus(reservationId, RESERVATION_FULFILLED);
  }
}
