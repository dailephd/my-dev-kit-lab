export interface InvoiceLine {
  unitCents: number;
  quantity: number;
}

export function roundToCents(value: number): number {
  return Math.round(value + Number.EPSILON);
}

export function applyBulkDiscount(subtotalCents: number, totalQuantity: number): number {
  if (totalQuantity >= 100) {
    return roundToCents(subtotalCents * 0.9);
  }
  if (totalQuantity >= 20) {
    return roundToCents(subtotalCents * 0.95);
  }
  return subtotalCents;
}

export function calculateInvoiceTotal(lines: readonly InvoiceLine[], taxRate: number): number {
  const subtotal = lines.reduce((sum, line) => sum + line.unitCents * line.quantity, 0);
  const quantity = lines.reduce((sum, line) => sum + line.quantity, 0);
  const discounted = applyBulkDiscount(subtotal, quantity);
  return discounted + roundToCents(discounted * taxRate);
}
