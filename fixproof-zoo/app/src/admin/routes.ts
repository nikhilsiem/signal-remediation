import type { FastifyInstance } from "fastify";
import { z } from "zod";
import type { Ctx } from "../context.ts";
import { blipUntil, FAULT_NAMES } from "../faults/registry.ts";
import { resetCache } from "../store/cache.ts";
import { bearerOk } from "./auth.ts";

const faultBody = z.object({ on: z.boolean(), params: z.record(z.string(), z.unknown()).optional() });
const keyBody = z.object({ key: z.string().min(1) });
const ALLOWED = ["pricing:v1:", "catalog:v1:"];

export async function adminRoutes(app: FastifyInstance, ctx: Ctx) {
  await app.register(async (s) => {
    s.addHook("onRequest", async (req, reply) => {
      if (!bearerOk(req.headers.authorization, ctx.cfg.adminToken)) return reply.code(401).send({ error: "unauthorized" });
    });
    s.get("/admin/faults", async () => {
      const f = await ctx.faults();
      return {
        faults: Object.fromEntries(FAULT_NAMES.map((n) => [n, { on: f[n]?.on ?? false, params: f[n]?.params ?? {} }])),
        poisoned: ctx.poisoned,
        failRate: ctx.overrides.failRate ?? ctx.cfg.failRate,
        latencyMs: ctx.overrides.latencyMs ?? ctx.cfg.latencyMs,
        revision: ctx.cfg.revision,
      };
    });
    s.post<{ Params: { name: string } }>("/admin/faults/:name", async (req, reply) => {
      const name = req.params.name;
      const body = faultBody.safeParse(req.body);
      if (!(FAULT_NAMES as readonly string[]).includes(name) || !body.success) return reply.code(400).send({ error: "bad request" });
      const params = { ...body.data.params };
      if (name === "blip") params.until = blipUntil(params.seconds, ctx.now());
      await ctx.store.setFault(name, { on: body.data.on, params });
      ctx.invalidateMemo();
      return { name, on: body.data.on, params };
    });
    s.post("/admin/poison", async () => {
      ctx.poisoned = true;
      return { poisoned: true };
    });
    s.post("/admin/cache/poison", async (req, reply) => {
      const body = keyBody.safeParse(req.body);
      if (!body.success) return reply.code(400).send({ error: "bad request" });
      await ctx.store.set(body.data.key, { price: "NaN", stale: true });
      return { poisoned: body.data.key };
    });
    s.post("/admin/reset", async () => {
      await ctx.store.clearFaults();
      await resetCache(ctx.store);
      ctx.poisoned = false;
      ctx.overrides = {};
      ctx.invalidateMemo();
      return { reset: true };
    });
    if (ctx.cfg.local)
      s.post("/admin/local-env", async (req) => {
        const b = z.object({ failRate: z.number().optional(), latencyMs: z.number().optional() }).parse(req.body);
        Object.assign(ctx.overrides, b);
        return ctx.overrides;
      });
  });

  app.post("/cache/invalidate", async (req, reply) => {
    if (!bearerOk(req.headers.authorization, ctx.cfg.cacheToken)) return reply.code(401).send({ error: "unauthorized" });
    const body = keyBody.safeParse(req.body);
    if (!body.success || !ALLOWED.some((p) => body.data.key.startsWith(p))) return reply.code(400).send({ error: "key not allowed" });
    const key = body.data.key;
    try {
      const deleted = key.endsWith("*") ? await ctx.store.deleteByPrefix(key.slice(0, -1)) : await ctx.store.delete(key);
      return { deleted };
    } catch {
      return reply.code(503).send({ error: "store unavailable" });
    }
  });
}
