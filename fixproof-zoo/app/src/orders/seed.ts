export interface Order {
  items: { sku: string; qty: number; price: number }[];
  discountPct: number;
  address: { postcode: string };
}
const items = [
  { sku: "A-100", qty: 2, price: 9.99 },
  { sku: "B-200", qty: 1, price: 24.5 },
];
export const SEED_ORDERS: Record<string, Order> = {
  "u-101": { items, discountPct: 10, address: { postcode: "2000" } },
  "u-102": { items: items.slice(0, 1), discountPct: 0, address: { postcode: "3000" } },
  "u-204": { items, discountPct: 0, address: null as never },
  "u-330": { items, discountPct: 120, address: { postcode: "4000" } },
};
