import type { Config } from "./config.ts";
import type { Faults, Store } from "./store/types.ts";
import type { Logger } from "./telemetry/logger.ts";
export interface Ctx {
  cfg: Config;
  store: Store;
  log: Logger;
  poisoned: boolean;
  overrides: { failRate?: number; latencyMs?: number };
  timers: Set<NodeJS.Timeout>;
  lastNoise: number;
  now: () => number;
  rand: () => number;
  faults: () => Promise<Faults>;
  invalidateMemo: () => void;
}
export function makeCtx(p: Pick<Ctx, "cfg" | "store" | "log"> & Partial<Pick<Ctx, "now" | "rand">>): Ctx {
  const now = p.now ?? Date.now;
  let memo: { at: number; v: Faults } | undefined;
  const ctx: Ctx = {
    ...p,
    now,
    rand: p.rand ?? Math.random,
    poisoned: false,
    overrides: {},
    timers: new Set(),
    lastNoise: 0,
    faults: async () => {
      if (memo && now() - memo.at < p.cfg.memoMs) return memo.v;
      memo = { at: now(), v: await p.store.getFaults() };
      return memo.v;
    },
    invalidateMemo: () => {
      memo = undefined;
    },
  };
  return ctx;
}
export function httpError(status: number, message: string) {
  return Object.assign(new Error(message), { statusCode: status });
}
