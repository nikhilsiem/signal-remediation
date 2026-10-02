import type { FastifyInstance } from "fastify";
import type { Ctx } from "../context.ts";
import { isOn } from "../faults/registry.ts";

export async function upstreamRoutes(app: FastifyInstance, ctx: Ctx) {
  app.get("/healthz", async () => ({ ok: true }));
  app.post("/pay", async () => {
    if (isOn(await ctx.faults(), "upstream_hang", ctx.now())) {
      await new Promise<void>((resolve) => {
        const t = setTimeout(() => {
          ctx.timers.delete(t);
          resolve();
        }, 30000);
        ctx.timers.add(t);
      });
    }
    return { paid: true };
  });
}
