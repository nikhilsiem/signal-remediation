import { expect, it } from "vitest";
import { getOrderSummary } from "../../app/src/orders/summary.ts";
it("orders with no address still summarise", () => {
  expect(getOrderSummary("u-204")).toMatchObject({ userId: "u-204", shipTo: "" });
});
