export interface Sample {
  t: number;
  ok: boolean;
}
export interface LoadOpts {
  baseUrl: string;
  mix: Record<string, number>;
  rps: number;
  minutes: number;
  signal?: AbortSignal;
  onTick?: (rate: number) => void;
}
const MAX_RPS = 5;
const MAX_MIN = 30;
export const isOk = (path: string, status: number) => status < 400 || (path === "/wp-login.php" && status === 404);

export function pick(mix: Record<string, number>, r = Math.random()): string {
  const entries = Object.entries(mix);
  let acc = 0;
  for (const [p, w] of entries) if (r < (acc += w / entries.reduce((a, [, x]) => a + x, 0))) return p;
  return entries[entries.length - 1][0];
}
export function successRate(samples: Sample[], sinceMs: number): number {
  const w = samples.filter((s) => s.t >= sinceMs);
  return w.length ? w.filter((s) => s.ok).length / w.length : 1;
}
export interface LoadHandle {
  samples: Sample[];
  done: Promise<void>;
  snapshots: { t: number; rate: number }[];
}
export function startLoad(o: LoadOpts): LoadHandle {
  const rps = Math.min(o.rps, MAX_RPS);
  const end = Date.now() + Math.min(o.minutes, MAX_MIN) * 60000;
  const samples: Sample[] = [];
  const snapshots: { t: number; rate: number }[] = [];
  const one = async () => {
    const path = pick(o.mix);
    try {
      const r = await fetch(o.baseUrl + path, { method: path === "/api/checkout" ? "POST" : "GET", signal: AbortSignal.timeout(10000) });
      samples.push({ t: Date.now(), ok: isOk(path, r.status) });
    } catch {
      samples.push({ t: Date.now(), ok: false });
    }
  };
  const done = (async () => {
    let lastTick = Date.now();
    while (Date.now() < end && !o.signal?.aborted) {
      void one();
      await new Promise((r) => setTimeout(r, 1000 / rps));
      if (Date.now() - lastTick >= 30000) {
        lastTick = Date.now();
        const rate = successRate(samples, Date.now() - 30000);
        snapshots.push({ t: lastTick, rate });
        o.onTick?.(rate);
      }
    }
    await new Promise((r) => setTimeout(r, 200));
  })();
  return { samples, done, snapshots };
}
