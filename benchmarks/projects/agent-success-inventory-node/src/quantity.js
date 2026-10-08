export const INVALID_QUANTITY = "INVALID_QUANTITY";

export class QuantityError extends Error {
  constructor(message) {
    super(message);
    this.name = "QuantityError";
    this.code = INVALID_QUANTITY;
  }
}

/**
 * Returns the quantity when it is a valid stock or reservation quantity, or throws QuantityError.
 */
export function assertPositiveInteger(value) {
  if (typeof value !== "number" || value < 0) {
    throw new QuantityError("quantity must be a positive integer");
  }
  return value;
}
