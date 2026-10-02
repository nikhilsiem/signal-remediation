import { loadConfig } from "./config.ts";
import { buildServer } from "./server.ts";
import { MemoryStore } from "./store/memory.ts";

export async function mk(opts: { role?: string; env?: Record<string, string>; rand?: () => number; now?: () => number } = {}) {
  const store = new MemoryStore();
  const lines: string[] = [];
  const cfg = loadConfig({ ZOO_ROLE: opts.role ?? "shop", ZOO_ADMIN_TOKEN: "adm", CACHE_INVALIDATE_TOKEN: "cch", FAULT_MEMO_MS: "0", ...opts.env });
  const { app, ctx } = await buildServer({ cfg, store, out: (l) => lines.push(l), rand: opts.rand, now: opts.now });
  const admin = (method: "GET" | "POST", url: string, payload?: object) =>
    app.inject({ method, url, headers: { authorization: "Bearer adm" }, payload });
  const fault = (name: string, on = true, params?: object) => admin("POST", `/admin/faults/${name}`, { on, params });
  const logs = () => lines.map((l) => JSON.parse(l) as Record<string, any>);
  return { app, ctx, store, lines, logs, admin, fault };
}
