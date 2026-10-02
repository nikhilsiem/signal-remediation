import { afterEach, describe, expect, it } from "vitest";
import { mk } from "./kit.ts";
import { PRICING_KEY, SEED_PRODUCTS } from "./store/cache.ts";
import { MemoryStore } from "./store/memory.ts";

const open: Array<{ close: () => Promise<unknown> }> = [];
const make = async (o?: Parameters<typeof mk>[0]) => {
  const k = await mk(o);
  open.push(k.app);
  return k;
};
afterEach(async () => {
  await Promise.all(open.splice(0).map((a) => a.close()));
});

describe("admin auth", () => {
  const routes: Array<["GET" | "POST", string, object?]> = [
    ["GET", "/admin/faults"],
    ["POST", "/admin/faults/noise", { on: true }],
    ["POST", "/admin/poison"],
    ["POST", "/admin/cache/poison", { key: "pricing:v1:catalog" }],
    ["POST", "/admin/reset"],
  ];
  for (const role of ["shop", "upstream"])
    for (const [method, url, payload] of routes)
      it(`${role} ${method} ${url} needs the token`, async () => {
        const k = await make({ role });
        expect((await k.app.inject({ method, url, payload })).statusCode).toBe(401);
        expect((await k.app.inject({ method, url, payload, headers: { authorization: "Bearer wrong" } })).statusCode).toBe(401);
        expect((await k.admin(method, url, payload)).statusCode).toBe(200);
      });
  it("rejects everything when no admin token is configured", async () => {
    const k = await make({ env: { ZOO_ADMIN_TOKEN: "" } });
    expect((await k.app.inject({ method: "GET", url: "/admin/faults", headers: { authorization: "Bearer " } })).statusCode).toBe(401);
  });
  it("lists and sets faults", async () => {
    const k = await make();
    expect((await k.admin("POST", "/admin/faults/bogus", { on: true })).statusCode).toBe(400);
    await k.fault("noise");
    expect((await k.admin("GET", "/admin/faults")).json().faults.noise.on).toBe(true);
    await k.admin("POST", "/admin/reset");
    expect((await k.admin("GET", "/admin/faults")).json().faults.noise.on).toBe(false);
  });
});

describe("cache invalidation", () => {
  const inv = (k: Awaited<ReturnType<typeof mk>>, key: unknown, token = "cch") =>
    k.app.inject({ method: "POST", url: "/cache/invalidate", headers: { authorization: `Bearer ${token}` }, payload: { key } });
  it("deletes an exact key and the next read rebuilds it", async () => {
    const k = await make();
    await k.admin("POST", "/admin/cache/poison", { key: PRICING_KEY });
    expect((await k.app.inject("/api/products")).statusCode).toBe(500);
    const r = await inv(k, PRICING_KEY);
    expect([r.statusCode, r.json()]).toEqual([200, { deleted: 1 }]);
    expect((await k.app.inject("/api/products")).json().products).toEqual(SEED_PRODUCTS);
  });
  it("deletes by prefix", async () => {
    const k = await make();
    await k.store.set("pricing:v1:a", 1);
    await k.store.set("pricing:v1:b", 2);
    await k.store.set("catalog:v1:c", 3);
    expect((await inv(k, "pricing:v1:*")).json()).toEqual({ deleted: 2 });
    expect(await k.store.get("catalog:v1:c")).toBe(3);
  });
  it("rejects other keys (400), bad token (401) and store failure (503)", async () => {
    const k = await make();
    for (const key of ["other:key", "*", "pricing:v2:x", 5]) expect((await inv(k, key)).statusCode).toBe(400);
    expect((await inv(k, PRICING_KEY, "nope")).statusCode).toBe(401);
    (k.store as MemoryStore).failing = true;
    expect((await inv(k, PRICING_KEY)).statusCode).toBe(503);
  });
});

describe("telemetry sinks", () => {
  it("boots and serves with no sink env vars", async () => {
    const k = await make({ env: {} });
    expect((await k.app.inject("/api/products")).statusCode).toBe(200);
  });
});
