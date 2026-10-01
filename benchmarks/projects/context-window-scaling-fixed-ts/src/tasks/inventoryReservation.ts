export interface StockLevel {
  sku: string;
  onHand: number;
  reserved: number;
}

export function availableStock(level: StockLevel): number {
  return level.onHand - level.reserved;
}

export function reserveStock(level: StockLevel, quantity: number): StockLevel {
  if (!Number.isInteger(quantity) || quantity <= 0) {
    throw new Error("Reservation quantity must be a positive integer.");
  }
  if (quantity > availableStock(level)) {
    throw new Error(`Insufficient stock for ${level.sku}.`);
  }
  return { ...level, reserved: level.reserved + quantity };
}

export function releaseReservation(level: StockLevel, quantity: number): StockLevel {
  if (!Number.isInteger(quantity) || quantity <= 0 || quantity > level.reserved) {
    throw new Error("Release quantity must be a positive integer no larger than the reserved amount.");
  }
  return { ...level, reserved: level.reserved - quantity };
}
