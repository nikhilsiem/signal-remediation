import { mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { FixproofClient } from "./fixproof-client.ts";
import type { Incident } from "./fixproof-client.ts";
import * as gcloud from "./gcloud.ts";
import { startLoad, successRate } from "./load.ts";
import { loadManifest } from "./manifest.ts";
import { ROOT, admin, envFromProcess, resetAll, runSteps, status } from "./runner.ts";
import { scoreRun } from "./score.ts";
import type { Scorecard } from "./score.ts";

const exec = promisify(execFile);
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const [cmd, arg, ...rest] = process.argv.slice(2);
const flags = new Set([arg, ...rest].filter((x) => x?.startsWith("--")));
const id = arg && !arg.startsWith("--") ? arg : undefined;
const resultsDir = (sid: string) => join(ROOT, "results", sid);
const need = <T,>(v: T | undefined, what: string): T => {
  if (v === undefined) throw new Error(`usage: zoo ${cmd} <${what}>`);
  return v;
};

async function hiddenTest(sid: string, branch?: string): Promise<boolean | undefined> {
  if (!branch) return undefined;
  const wt = join(ROOT, ".tmp", `pr-${sid}`);
  try {
    await exec("git", ["fetch", "origin", branch], { cwd: ROOT });
    await exec("git", ["worktree", "add", "--force", wt, "FETCH_HEAD"], { cwd: ROOT });
    await exec("cp", [join(ROOT, "bugs", sid, "hidden.test.ts"), join(wt, "bugs", sid, "hidden.test.ts")]).catch(async () => {
      await exec("mkdir", ["-p", join(wt, "bugs", sid)]);
      await exec("cp", [join(ROOT, "bugs", sid, "hidden.test.ts"), join(wt, "bugs", sid, "hidden.test.ts")]);
    });
    await exec("pnpm", ["install", "--frozen-lockfile", "--prefer-offline"], { cwd: wt });
    await writeFileSync(join(wt, "vitest.hidden.config.ts"), 'export default { test: { include: ["bugs/**/*.test.ts"] } };');
    await exec("pnpm", ["vitest", "run", "--config", "vitest.hidden.config.ts", `bugs/${sid}/hidden.test.ts`], { cwd: wt });
    return true;
  } catch {
    return false;
  } finally {
    await exec("git", ["worktree", "remove", "--force", wt], { cwd: ROOT }).catch(() => {});
  }
}

function print(sid: string, c: Scorecard) {
  const mark = (s: { pass: boolean }) => (s.pass ? "PASS" : "FAIL");
  console.log(`\nScorecard ${sid}`);
  for (const k of ["ingested", "diagnosis", "tier", "action", "verification", "fixPr"] as const)
    console.log(`  ${k.padEnd(13)} ${mark(c[k])}  ${c[k].note ?? ""}`);
  if (c.diagnosis.text) console.log(`  diagnosis text (judge by hand): ${c.diagnosis.text}`);
  console.log(`  timing        incident ${c.timing.toIncidentS ?? "-"}s, recovery ${c.timing.toRecoveryS ?? "-"}s`);
  if (c.safetyFailure) console.log(`\n  !!! SAFETY FAILURE: ${c.safetyFailure}`);
  if (c.falseVerification) console.log(`  !!! FALSE VERIFICATION`);
}

async function run(sid: string) {
  const env = envFromProcess();
  const m = loadManifest(sid);
  const st = await status(env);
  if (st.active.length) throw new Error(`refusing to start: active faults: ${st.active.join(", ")}. Run: zoo reset`);
  if (m.requires && !flags.has("--force") && st.ageMinutes !== undefined && st.ageMinutes < m.requires.noDeployWithinMinutes)
    throw new Error(`latest revision is ${Math.round(st.ageMinutes)} min old; ${sid} needs >= ${m.requires.noDeployWithinMinutes}. Wait or pass --force`);
  const fx = env.local && !process.env.FIXPROOF_API_URL ? undefined : new FixproofClient();
  const startMs = Date.now();
  await runSteps(env, m.trigger);
  console.log(`triggered ${sid} (${m.name}); load ${m.load.rps} rps for up to ${m.load.minutes} min`);
  const ctl = new AbortController();
  const load = startLoad({ baseUrl: env.shopUrl, ...m.load, signal: ctl.signal, onTick: (r) => console.log(`  client success ${(r * 100).toFixed(1)}%`) });
  let incident: Incident | null = null;
  let approved = false;
  let finished = false;
  void load.done.then(() => (finished = true));
  while (!finished && fx) {
    await sleep(15000);
    incident = await fx.findIncident(startMs).catch((e) => (console.error(String(e.message)), incident));
    if (incident?.awaitingApproval && flags.has("--approve") && !approved) {
      approved = true;
      console.log(`  approving ${incident.id} (action ${incident.action})`);
      await fx.approve(incident.id);
    }
    if (incident && incident.verification !== "none") break;
  }
  if (!fx) console.log("  FIXPROOF_API_URL not set: running load only (no scoring against Fixproof)");
  if (!fx) await load.done;
  ctl.abort();
  await load.done;
  const rate = successRate(load.samples, Date.now() - m.oracle.windowMinutes * 60000);
  const oracle = { successRate: rate, recovered: rate >= m.oracle.clientSuccessAbove };
  const dip = load.snapshots.findIndex((s) => s.rate < m.oracle.clientSuccessAbove);
  const rec = dip >= 0 ? load.snapshots.slice(dip).find((s) => s.rate >= m.oracle.clientSuccessAbove) : undefined;
  const hidden = incident?.pr ? await hiddenTest(sid, incident.pr.branch) : undefined;
  const card = scoreRun(m, incident, oracle, { startMs, recoveryMs: rec?.t, hiddenTestPassed: hidden });
  mkdirSync(resultsDir(sid), { recursive: true });
  writeFileSync(join(resultsDir(sid), `${new Date(startMs).toISOString().replace(/[:.]/g, "-")}.json`), JSON.stringify({ sid, startMs, incident, oracle, hidden, card }, null, 2));
  print(sid, card);
  await resetAll(env, m);
}

function latest(sid: string) {
  const f = readdirSync(resultsDir(sid)).sort().pop();
  if (!f) throw new Error(`no results for ${sid}`);
  return JSON.parse(readFileSync(join(resultsDir(sid), f), "utf8"));
}

async function main() {
  const env = envFromProcess();
  switch (cmd) {
    case "local": {
      const { startLocal } = await import("./local.ts");
      const l = await startLocal();
      console.log(`shop ${l.shopUrl}  upstream ${l.upstreamUrl}\nadmin token: local-admin  cache token: local-cache`);
      return new Promise(() => {});
    }
    case "status": {
      const s = await status(env);
      console.log(`revision ${s.revision}${s.ageMinutes !== undefined ? ` (${Math.round(s.ageMinutes)} min old, ${s.percentOnLatest}% traffic)` : ""}`);
      console.log(`active faults: ${s.active.join(", ") || "none"}`);
      console.log(`client success (20 probes): ${(s.successRate * 100).toFixed(1)}%`);
      return;
    }
    case "trigger":
      return runSteps(env, loadManifest(need(id, "scenario")).trigger);
    case "load": {
      const m = loadManifest(need(id, "scenario"));
      const h = startLoad({ baseUrl: env.shopUrl, ...m.load, onTick: (r) => console.log(`client success ${(r * 100).toFixed(1)}%`) });
      return h.done;
    }
    case "reset": {
      await resetAll(env);
      if (!env.local) {
        const s = await gcloud.serving();
        if (s.percentOnLatest < 100) console.log(`WARNING: only ${s.percentOnLatest}% of traffic is on the newest revision ${s.revision}`);
      }
      console.log("reset done");
      return;
    }
    case "seed-bug": {
      const sid = need(id, "scenario");
      return runSteps(env, [{ seedBug: sid }]);
    }
    case "run":
      return run(need(id, "scenario"));
    case "score": {
      const sid = need(id, "scenario");
      const r = latest(sid);
      print(sid, scoreRun(loadManifest(sid), r.incident ?? null, r.oracle, { startMs: r.startMs, hiddenTestPassed: r.hidden }));
      return;
    }
    case "report": {
      const rows: string[] = [];
      for (const sid of readdirSync(join(ROOT, "results")).sort()) {
        const c: Scorecard = latest(sid).card;
        const f = (s: { pass: boolean }) => (s.pass ? "pass" : "FAIL");
        rows.push([sid, f(c.ingested), f(c.diagnosis), f(c.tier), f(c.action), f(c.verification), f(c.fixPr), c.safetyFailure ? "SAFETY" : "-", c.falseVerification ? "FALSE" : "-"].map((x) => x.padEnd(9)).join(""));
      }
      console.log(["id", "ingest", "diagnose", "tier", "action", "verify", "fixPr", "safety", "falseVer"].map((x) => x.padEnd(9)).join(""));
      console.log(rows.join("\n"));
      return;
    }
    default:
      console.log("usage: zoo <local|status|trigger|load|reset|seed-bug|run|score|report> [scenario] [--approve] [--force]");
  }
}
main().catch((e) => {
  console.error(String(e.message ?? e));
  process.exit(1);
});
