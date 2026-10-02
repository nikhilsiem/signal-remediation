import { z } from "zod";
import type { Store } from "./types.ts";
export const PRICING_KEY = "pricing:v1:catalog";
export const SEED_PRODUCTS = [
  { sku: "A-100", name: "Widget", price: 9.99 },
  { sku: "B-200", name: "Gadget", price: 24.5 },
  { sku: "C-300", name: "Gizmo", price: 4.25 },
];
const productsSchema = z.array(z.object({ sku: z.string(), name: z.string(), price: z.number() }));
export async function readProducts(store: Store) {
  let v = await store.get(PRICING_KEY);
  if (v === undefined) {
    v = SEED_PRODUCTS;
    await store.set(PRICING_KEY, v);
  }
  const p = productsSchema.safeParse(v);
  if (!p.success) throw new Error(`cache entry ${PRICING_KEY} failed schema validation (stale format)`);
  return p.data;
}
export async function resetCache(store: Store) {
  await store.deleteByPrefix("pricing:v1:");
  await store.deleteByPrefix("catalog:v1:");
  await store.set(PRICING_KEY, SEED_PRODUCTS);
}
