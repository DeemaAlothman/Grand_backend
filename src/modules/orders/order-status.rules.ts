import { OrderStatus } from '@prisma/client';

/** Allowed forward transitions. Anything not listed here is rejected. */
export const ALLOWED_TRANSITIONS: Record<OrderStatus, OrderStatus[]> = {
  DRAFT: ['PENDING_PAYMENT', 'CANCELLED'],
  PENDING_PAYMENT: ['PAID', 'PAYMENT_FAILED', 'CANCELLED'],
  PAYMENT_FAILED: ['PENDING_PAYMENT', 'CANCELLED'],
  PAID: ['CONFIRMED', 'CANCELLED'],
  CONFIRMED: ['PROCESSING', 'CANCELLED'],
  PROCESSING: ['READY_TO_SHIP', 'CANCELLED'],
  READY_TO_SHIP: ['SHIPPED'],
  SHIPPED: ['DELIVERED', 'RETURN_REQUESTED'],
  DELIVERED: ['RETURN_REQUESTED'],
  RETURN_REQUESTED: ['RETURNED'],
  RETURNED: ['REFUNDED'],
  CANCELLED: [],
  REFUNDED: [],
};

/**
 * Where a status sits relative to inventory:
 * - RESERVED: stock is held (quantityReserved) but still physically on hand.
 * - DEDUCTED: stock has been committed/left the warehouse (quantityOnHand reduced).
 * - NONE: no inventory effect (either never reserved, or already released/returned).
 */
export type StockPhase = 'RESERVED' | 'DEDUCTED' | 'NONE';

export function stockPhaseFor(status: OrderStatus): StockPhase {
  switch (status) {
    case 'DRAFT':
    case 'PENDING_PAYMENT':
    case 'PAID':
      return 'RESERVED';
    case 'CONFIRMED':
    case 'PROCESSING':
    case 'READY_TO_SHIP':
    case 'SHIPPED':
    case 'DELIVERED':
      return 'DEDUCTED';
    default:
      return 'NONE';
  }
}

export function canTransition(from: OrderStatus, to: OrderStatus): boolean {
  return ALLOWED_TRANSITIONS[from].includes(to);
}
