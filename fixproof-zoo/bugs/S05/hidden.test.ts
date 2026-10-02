import { expect, it } from "vitest";
import { getOrderSummary } from "../../app/src/orders/summary.ts";
import { orderTotal } from "../../app/src/orders/pricing.ts";
it("discounts over 100% clamp to a zero total", () => {
  expect(orderTotal([{ qty: 1, price: 10 }], 120)).toBe(0);
  expect(getOrderSummary("u-330")?.total).toBe(0);
});
