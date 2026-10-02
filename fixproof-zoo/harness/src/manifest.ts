import { readdirSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { parse } from "yaml";
import { z } from "zod";

export const ACTIONS = ["cloudrun.rollback", "cloudrun.restart", "cache.invalidate", "github.fix_pr"] as const;
export const DEFAULT_MIX = { "/api/products": 0.5, "/api/orders/u-101": 0.3, "/api/checkout": 0.2 };

const step = z.union([
  z.object({ admin: z.string().regex(/^(GET|POST) \//), body: z.record(z.string(), z.unknown()).optional() }),
  z.object({ deploy: z.object({ env: z.record(z.string(), z.union([z.string(), z.number()])) }) }),
  z.object({ seedBug: z.string() }),
]);
const RESET = [{ admin: "POST /admin/reset" }];
const verdict = z.enum(["success", "failure", "none"]);

export const ManifestSchema = z
  .object({
    id: z.string().regex(/^S\d{2}$/),
    name: z.string(),
    kind: z.enum(["positive", "negative"]),
    requires: z.object({ noDeployWithinMinutes: z.number() }).optional(),
    trigger: z.array(step).min(1),
    load: z
      .object({
        rps: z.number().max(5).default(3),
        minutes: z.number().max(30).default(20),
        mix: z.record(z.string(), z.number()).default(DEFAULT_MIX),
      })
      .default({}),
    truth: z.object({
      rootCause: z.string(),
      component: z.string().optional(),
      diagnosisChecklist: z.array(z.string()).default([]),
      expectedAction: z.string(),
      acceptableActions: z.array(z.string()),
      forbiddenActions: z.array(z.string()).optional(),
      expectedTier: z.array(z.string()),
      expectedVerification: z.union([verdict, z.array(verdict)]),
      fixPr: z.boolean().default(false),
    }),
    faultStaysOn: z.boolean().default(true),
    oracle: z
      .object({ errorRateBelow: z.number().default(0.01), clientSuccessAbove: z.number().default(0.99), windowMinutes: z.number().default(5) })
      .default({}),
    reset: z.array(step).default(RESET),
    repeats: z.number().default(3),
  })
  .transform((m) => ({
    ...m,
    truth: {
      ...m.truth,
      forbiddenActions: m.truth.forbiddenActions ?? ACTIONS.filter((a) => !m.truth.acceptableActions.includes(a)),
      expectedVerification: [m.truth.expectedVerification].flat(),
    },
  }));
export type Manifest = z.infer<typeof ManifestSchema>;
export type Step = Manifest["trigger"][number];

export const SCENARIO_DIR = resolve(import.meta.dirname, "../../scenarios");
export function loadAll(dir = SCENARIO_DIR): Manifest[] {
  return readdirSync(dir)
    .filter((f) => f.endsWith(".yaml"))
    .sort()
    .map((f) => {
      const r = ManifestSchema.safeParse(parse(readFileSync(join(dir, f), "utf8")));
      if (!r.success) throw new Error(`${f}: ${r.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ")}`);
      return r.data;
    });
}
export function loadManifest(id: string, dir = SCENARIO_DIR): Manifest {
  const m = loadAll(dir).find((x) => x.id === id.toUpperCase());
  if (!m) throw new Error(`unknown scenario ${id}`);
  return m;
}
