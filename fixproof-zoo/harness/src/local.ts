import { loadConfig } from "../../app/src/config.ts";
import { buildServer } from "../../app/src/server.ts";
import { MemoryStore } from "../../app/src/store/memory.ts";

export const LOCAL_ADMIN = "local-admin";
export const LOCAL_CACHE = "local-cache";
export async function startLocal(ports = { shop: 8080, upstream: 8081 }) {
  const store = new MemoryStore();
  const base = { ZOO_ADMIN_TOKEN: LOCAL_ADMIN, CACHE_INVALIDATE_TOKEN: LOCAL_CACHE, ZOO_LOCAL: "1", FAULT_MEMO_MS: "0" };
  const up = await buildServer({ cfg: loadConfig({ ...base, ZOO_ROLE: "upstream" }), store });
  await up.app.listen({ port: ports.upstream, host: "127.0.0.1" });
  const upstreamUrl = `http://127.0.0.1:${(up.app.server.address() as { port: number }).port}`;
  const shop = await buildServer({ cfg: loadConfig({ ...base, ZOO_ROLE: "shop", UPSTREAM_URL: upstreamUrl }), store });
  await shop.app.listen({ port: ports.shop, host: "127.0.0.1" });
  const shopUrl = `http://127.0.0.1:${(shop.app.server.address() as { port: number }).port}`;
  return { shopUrl, upstreamUrl, store, close: async () => void (await Promise.all([shop.app.close(), up.app.close()])) };
}
