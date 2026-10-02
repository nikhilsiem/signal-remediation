import { orderTotal } from "./pricing.ts";
import { SEED_ORDERS } from "./seed.ts";
export function getOrderSummary(userId: string) {
  const order = SEED_ORDERS[userId];
  if (!order) return undefined;
  return {
    userId,
    lines: order.items.length,
    total: orderTotal(order.items, order.discountPct),
    shipTo: order.address.postcode,
  };
}
