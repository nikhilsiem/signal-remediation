export type Role = "shop" | "upstream";
export interface Config {
  role: Role;
  adminToken?: string;
  cacheToken?: string;
  upstreamUrl: string;
  failRate: number;
  latencyMs: number;
  memoMs: number;
  local: boolean;
  revision: string;
}
const num = (v: string | undefined, d: number) => (v !== undefined && v !== "" && !Number.isNaN(Number(v)) ? Number(v) : d);
export function loadConfig(env: Record<string, string | undefined> = process.env): Config {
  return {
    role: env.ZOO_ROLE === "upstream" ? "upstream" : "shop",
    adminToken: env.ZOO_ADMIN_TOKEN || undefined,
    cacheToken: env.CACHE_INVALIDATE_TOKEN || undefined,
    upstreamUrl: env.UPSTREAM_URL ?? "http://127.0.0.1:8081",
    failRate: num(env.FAIL_RATE, 0),
    latencyMs: num(env.LATENCY_MS, 0),
    memoMs: num(env.FAULT_MEMO_MS, 5000),
    local: env.ZOO_LOCAL === "1",
    revision: env.K_REVISION ?? "local",
  };
}
