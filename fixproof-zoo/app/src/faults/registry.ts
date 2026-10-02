import type { Faults } from "../store/types.ts";
export const FAULT_NAMES = ["noise", "flap", "inject", "upstream_hang", "shared_wedge", "blip"] as const;
export type FaultName = (typeof FAULT_NAMES)[number];
const num = (v: unknown, d: number) => (typeof v === "number" && v > 0 ? v : d);
export function isOn(f: Faults, name: FaultName, nowMs: number): boolean {
  const s = f[name];
  if (!s?.on) return false;
  if (name === "blip") return nowMs < num(s.params.until, 0);
  if (name === "flap") {
    const on = num(s.params.onSeconds, 180);
    const off = num(s.params.offSeconds, 180);
    return (nowMs / 1000) % (on + off) < on;
  }
  return true;
}
export const noiseRate = (f: Faults) => num(f.noise?.params.ratePerMin, 30);
export const blipUntil = (seconds: unknown, nowMs: number) => nowMs + num(seconds, 240) * 1000;
