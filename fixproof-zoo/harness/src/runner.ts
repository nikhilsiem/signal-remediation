import { execFile } from "node:child_process";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { promisify } from "node:util";
import * as gcloud from "./gcloud.ts";
import { isOk, pick } from "./load.ts";
import type { Manifest, Step } from "./manifest.ts";

const exec = promisify(execFile);
export const ROOT = resolve(import.meta.dirname, "../..");
export interface Env {
  shopUrl: string;
  adminToken: string;
  local: boolean;
}
export function envFromProcess(): Env {
  const shopUrl = (process.env.ZOO_SHOP_URL ?? "http://127.0.0.1:8080").replace(/\/$/, "");
  const local = /^https?:\/\/(127\.0\.0\.1|localhost)/.test(shopUrl);
  return { shopUrl, local, adminToken: process.env.ZOO_ADMIN_TOKEN ?? (local ? "local-admin" : "") };
}

export async function admin(env: Env, spec: string, body?: unknown) {
  const [method, path] = spec.split(" ");
  const r = await fetch(env.shopUrl + path, {
    method,
    headers: { authorization: `Bearer ${env.adminToken}`, ...(body ? { "content-type": "application/json" } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!r.ok) throw new Error(`${spec} -> ${r.status}`);
  return r.json() as Promise<any>;
}

async function seedBug(env: Env, id: string) {
  if (env.local) return console.log(`  (local) seed-bug ${id} skipped: needs git push and a Cloud Run deploy`);
  const msg = readFileSync(resolve(ROOT, "bugs", id, "commit-message.txt"), "utf8").trim();
  const git = (...a: string[]) => exec("git", a, { cwd: ROOT });
  await git("apply", `bugs/${id}/bug.patch`);
  await git("commit", "-am", msg);
  await git("push", "origin", "main");
  await exec("bash", ["infra/deploy.sh"], { cwd: ROOT, env: { ...process.env, BUILD_STAMP: String(Date.now()) } });
  await gcloud.updateEnv("zoo-shop", { BUILD_STAMP: Date.now() + 1 });
}

export async function runSteps(env: Env, steps: Step[]) {
  for (const s of steps) {
    if ("admin" in s) await admin(env, s.admin, s.body);
    else if ("deploy" in s)
      env.local
        ? await admin(env, "POST /admin/local-env", {
            failRate: Number(s.deploy.env.FAIL_RATE ?? 0),
            latencyMs: Number(s.deploy.env.LATENCY_MS ?? 0),
          })
        : await gcloud.updateEnv("zoo-shop", s.deploy.env);
    else await seedBug(env, s.seedBug);
  }
}
export async function resetAll(env: Env, m?: Manifest) {
  await admin(env, "POST /admin/reset");
  if (!env.local && m?.trigger.some((s) => "deploy" in s)) await gcloud.updateEnv("zoo-shop", { FAIL_RATE: 0, LATENCY_MS: 0 });
}

export async function probe(env: Env, n = 20) {
  const mix = { "/api/products": 0.5, "/api/orders/u-101": 0.3, "/api/checkout": 0.2 };
  let ok = 0;
  for (let i = 0; i < n; i++) {
    const path = pick(mix);
    try {
      const r = await fetch(env.shopUrl + path, { method: path === "/api/checkout" ? "POST" : "GET", signal: AbortSignal.timeout(10000) });
      ok += isOk(path, r.status) ? 1 : 0;
    } catch {}
  }
  return ok / n;
}
export async function status(env: Env) {
  const a = await admin(env, "GET /admin/faults");
  const active = Object.entries(a.faults as Record<string, { on: boolean }>).filter(([, s]) => s.on).map(([n]) => n);
  if (a.poisoned) active.push("poison");
  if (a.failRate > 0) active.push(`FAIL_RATE=${a.failRate}`);
  if (a.latencyMs > 0) active.push(`LATENCY_MS=${a.latencyMs}`);
  const rev = env.local ? undefined : await gcloud.serving();
  return { revision: rev?.revision ?? a.revision, ageMinutes: rev?.ageMinutes, percentOnLatest: rev?.percentOnLatest, active, successRate: await probe(env) };
}
