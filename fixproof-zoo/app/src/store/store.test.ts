import { describe, expect, it } from "vitest";
import { MemoryStore } from "./memory.ts";
import { PostgresStore } from "./postgres.ts";
import type { Store } from "./types.ts";

function suite(name: string, make: () => Store, enabled = true) {
  describe.runIf(enabled)(`${name} store`, () => {
    it("get/set/delete", async () => {
      const s = make();
      await s.deleteByPrefix("t:");
      expect(await s.get("t:a")).toBeUndefined();
      await s.set("t:a", { x: 1 });
      expect(await s.get("t:a")).toEqual({ x: 1 });
      expect(await s.delete("t:a")).toBe(1);
      expect(await s.delete("t:a")).toBe(0);
    });
    it("deleteByPrefix", async () => {
      const s = make();
      await s.set("t:1", 1);
      await s.set("t:2", 2);
      await s.set("u:1", 3);
      expect(await s.deleteByPrefix("t:")).toBe(2);
      expect(await s.get("u:1")).toBe(3);
      await s.delete("u:1");
    });
    it("faults set/clear", async () => {
      const s = make();
      await s.setFault("noise", { on: true, params: { ratePerMin: 5 } });
      expect((await s.getFaults()).noise).toEqual({ on: true, params: { ratePerMin: 5 } });
      await s.clearFaults();
      expect(await s.getFaults()).toEqual({});
    });
  });
}
suite("memory", () => new MemoryStore());
const url = process.env.ZOO_TEST_DATABASE_URL;
suite("postgres", () => new PostgresStore(url!), !!url);
