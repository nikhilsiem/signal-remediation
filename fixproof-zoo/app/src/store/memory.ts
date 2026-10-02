import type { Faults, FaultState, Store } from "./types.ts";
export class MemoryStore implements Store {
  cache = new Map<string, unknown>();
  faults: Faults = {};
  failing = false;
  private check() {
    if (this.failing) throw new Error("store unavailable");
  }
  async get(key: string) {
    this.check();
    return this.cache.get(key);
  }
  async set(key: string, value: unknown) {
    this.check();
    this.cache.set(key, value);
  }
  async delete(key: string) {
    this.check();
    return this.cache.delete(key) ? 1 : 0;
  }
  async deleteByPrefix(prefix: string) {
    this.check();
    let n = 0;
    for (const k of [...this.cache.keys()]) if (k.startsWith(prefix)) n += this.cache.delete(k) ? 1 : 0;
    return n;
  }
  async getFaults() {
    this.check();
    return structuredClone(this.faults);
  }
  async setFault(name: string, state: FaultState) {
    this.check();
    this.faults[name] = structuredClone(state);
  }
  async clearFaults() {
    this.check();
    this.faults = {};
  }
}
