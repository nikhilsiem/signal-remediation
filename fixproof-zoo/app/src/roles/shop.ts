import type { FastifyInstance } from "fastify";
import type { Ctx } from "../context.ts";
import { httpError } from "../context.ts";
import { DEPRECATION, PIPELINE_ERROR, UPSTREAM_ERROR, WEDGE_ERROR } from "../faults/messages.ts";
import { isOn, noiseRate } from "../faults/registry.ts";
import { getOrderSummary } from "../orders/summary.ts";
import { readProducts } from "../store/cache.ts";

export async function shopRoutes(app: FastifyInstance, ctx: Ctx) {
  app.get("/", async (_req, reply) => {
    const f = await ctx.faults();
    const active = Object.entries(f).filter(([, s]) => s.on).map(([n]) => n);
    if (ctx.poisoned) active.push("poison");
    reply.type("text/plain").send(`revision: ${ctx.cfg.revision}\nactive faults: ${active.join(", ") || "none"}\n`);
  });

  await app.register(async (s) => {
    s.addHook("onRequest", async (req) => {
      const f = await ctx.faults();
      const now = ctx.now();
      const latency = ctx.overrides.latencyMs ?? ctx.cfg.latencyMs;
      if (latency > 0) await new Promise((r) => setTimeout(r, latency));
      if (ctx.poisoned || isOn(f, "shared_wedge", now)) throw httpError(503, WEDGE_ERROR);
      if (isOn(f, "noise", now) && now - ctx.lastNoise >= 60000 / noiseRate(f)) {
        ctx.lastNoise = now;
        ctx.log.write({ severity: "ERROR", message: DEPRECATION });
      }
      if (req.url.startsWith("/healthz")) return;
      const failRate = ctx.overrides.failRate ?? ctx.cfg.failRate;
      if (ctx.rand() < failRate) throw httpError(500, PIPELINE_ERROR);
      if ((isOn(f, "flap", now) || isOn(f, "blip", now)) && ctx.rand() < 0.4) throw httpError(500, PIPELINE_ERROR);
    });
    s.get("/healthz", async () => ({ ok: true }));
    s.get("/api/products", async () => ({ products: await readProducts(ctx.store) }));
    s.get<{ Params: { userId: string } }>("/api/orders/:userId", async (req, reply) => {
      const summary = getOrderSummary(req.params.userId);
      return summary ?? reply.code(404).send({ error: "not found" });
    });
    s.post("/api/checkout", async () => {
      try {
        const r = await fetch(`${ctx.cfg.upstreamUrl}/pay`, { method: "POST", signal: AbortSignal.timeout(2000) });
        if (!r.ok) throw new Error("bad status");
        return { paid: true };
      } catch {
        throw httpError(504, UPSTREAM_ERROR);
      }
    });
  });
}
