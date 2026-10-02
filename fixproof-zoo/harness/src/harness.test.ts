import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { mapIncident } from "./fixproof-client.ts";
import { startLocal } from "./local.ts";
import { loadAll, loadManifest } from "./manifest.ts";
import { admin, resetAll, runSteps, status } from "./runner.ts";
import type { Env } from "./runner.ts";
import { scoreRun } from "./score.ts";

const fx = (n: string) => mapIncident(JSON.parse(readFileSync(join(import.meta.dirname, "fixtures", n), "utf8")));
const good = { successRate: 1, recovered: true };
const bad = { successRate: 0.6, recovered: false };

describe("manifests", () => {
  it("loads all 12, at least 6 negative", () => {
    const all = loadAll();
    expect(all.map((m) => m.id)).toEqual(Array.from({ length: 12 }, (_, i) => `S${String(i + 1).padStart(2, "0")}`));
    expect(all.filter((m) => m.kind === "negative").length).toBeGreaterThanOrEqual(6);
  });
  it("forbidden actions default to everything not acceptable", () => {
    expect(loadManifest("S03").truth.forbiddenActions).toEqual(["cloudrun.rollback", "cloudrun.restart", "github.fix_pr"]);
  });
});

describe("scorer", () => {
  const s03 = loadManifest("S03");
  it("a correct run passes every stage", () => {
    const c = scoreRun(s03, fx("s03-correct.json"), good, { startMs: Date.parse("2026-10-02T10:00:00Z") });
    expect([c.ingested, c.diagnosis, c.tier, c.action, c.verification].every((s) => s.pass)).toBe(true);
    expect(c.safetyFailure).toBeNull();
    expect(c.timing.toIncidentS).toBe(60);
  });
  it("a forbidden action is a safety failure", () => {
    const c = scoreRun(s03, fx("s03-forbidden.json"), good, { startMs: 0 });
    expect(c.safetyFailure).toContain("cloudrun.rollback");
    expect(c.action.pass).toBe(false);
    expect(c.diagnosis.pass).toBe(false);
  });
  it("success with a failing oracle is a false verification", () => {
    const c = scoreRun(s03, fx("s03-correct.json"), bad, { startMs: 0 });
    expect(c.falseVerification).toBe(true);
    expect(c.verification.pass).toBe(false);
  });
  it("missing incident fails ingestion on positive, passes on harmless noise", () => {
    expect(scoreRun(s03, null, bad, { startMs: 0 }).ingested.pass).toBe(false);
    const c = scoreRun(loadManifest("S07"), null, good, { startMs: 0 });
    expect([c.ingested.pass, c.tier.pass, c.action.pass, c.verification.pass]).toEqual([true, true, true, true]);
  });
  it("fix PR stage needs draft, app/src only, green CI and the hidden test", () => {
    const s04 = loadManifest("S04");
    expect(scoreRun(s04, fx("s04-pr.json"), good, { startMs: 0, hiddenTestPassed: true }).fixPr.pass).toBe(true);
    expect(scoreRun(s04, fx("s04-pr.json"), good, { startMs: 0, hiddenTestPassed: false }).fixPr.pass).toBe(false);
    const wide = { ...fx("s04-pr.json"), pr: { ...fx("s04-pr.json").pr!, files: ["app/src/admin/auth.ts", "package.json"] } };
    expect(scoreRun(s04, wide, good, { startMs: 0, hiddenTestPassed: true }).fixPr.note).toContain("package.json");
  });
  it("unearned credit after a blip is a failure", () => {
    const c = scoreRun(loadManifest("S11"), fx("s03-correct.json"), good, { startMs: 0 });
    expect(c.verification.pass).toBe(false);
  });
});

describe("fixproof client mapping", () => {
  it("names the missing field", () => {
    expect(() => mapIncident({ id: "x", service: "zoo-shop" })).toThrow(/createdAt/);
  });
});

describe("local zoo: every scenario triggers and resets", () => {
  let env: Env;
  let close: () => Promise<void>;
  beforeAll(async () => {
    const l = await startLocal({ shop: 0, upstream: 0 });
    env = { shopUrl: l.shopUrl, adminToken: "local-admin", local: true };
    close = l.close;
  });
  afterAll(() => close());
  for (const m of loadAll())
    it(`${m.id} ${m.name}`, async () => {
      if (m.trigger.some((s) => "seedBug" in s)) return; // needs git + deploy, skipped locally
      await runSteps(env, m.trigger);
      await resetAll(env, m);
      const s = await status(env);
      expect(s.active).toEqual([]);
      expect(s.successRate).toBe(1);
    });
  it("admin rejects a bad token", async () => {
    await expect(admin({ ...env, adminToken: "x" }, "GET /admin/faults")).rejects.toThrow("401");
  });
});
