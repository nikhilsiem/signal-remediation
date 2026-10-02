import Fastify from "fastify";
import type { FastifyInstance } from "fastify";
import { adminRoutes } from "./admin/routes.ts";
import type { Config } from "./config.ts";
import { makeCtx } from "./context.ts";
import type { Ctx } from "./context.ts";
import { INJECT_SUFFIX } from "./faults/messages.ts";
import { isOn } from "./faults/registry.ts";
import { shopRoutes } from "./roles/shop.ts";
import { upstreamRoutes } from "./roles/upstream.ts";
import type { Store } from "./store/types.ts";
import { cleanStack, createLogger } from "./telemetry/logger.ts";
import type { Sink } from "./telemetry/logger.ts";

declare module "fastify" {
  interface FastifyRequest {
    t0: number;
  }
}

export interface BuildOpts {
  cfg: Config;
  store: Store;
  out?: (line: string) => void;
  sinks?: Sink[];
  now?: () => number;
  rand?: () => number;
}
export interface ZooApp {
  app: FastifyInstance;
  ctx: Ctx;
}

const GENERIC: Record<number, string> = { 503: "service unavailable", 504: "upstream timeout" };

export async function buildServer(opts: BuildOpts): Promise<ZooApp> {
  const ctx = makeCtx({ cfg: opts.cfg, store: opts.store, log: createLogger(opts.out, opts.sinks), now: opts.now, rand: opts.rand });
  const app = Fastify({ logger: false, forceCloseConnections: true });
  app.decorateRequest("t0", 0);
  const route = (url: string, tpl?: string) => tpl ?? url.split("?")[0];
  const admin = (url: string) => url.startsWith("/admin") || url.startsWith("/cache");

  app.addHook("onRequest", async (req) => {
    req.t0 = performance.now();
  });
  app.addHook("onResponse", async (req, reply) => {
    const status = reply.statusCode;
    if (status >= 500 || admin(req.url)) return;
    ctx.log.write({
      severity: status >= 400 ? "WARNING" : "INFO",
      message: status >= 400 ? "request rejected" : "request completed",
      route: route(req.url, req.routeOptions?.url),
      status,
      latencyMs: Math.round(performance.now() - req.t0),
    });
  });
  app.setErrorHandler(async (err: Error & { statusCode?: number }, req, reply) => {
    const status = err.statusCode ?? 500;
    if (status >= 500 && !admin(req.url)) {
      let message = `${err.name}: ${err.message}`;
      if (isOn(await ctx.faults().catch(() => ({})), "inject", ctx.now())) message += " " + INJECT_SUFFIX;
      ctx.log.write({
        severity: "ERROR",
        message,
        stack_trace: cleanStack(err),
        route: route(req.url, req.routeOptions?.url),
        status,
        latencyMs: Math.round(performance.now() - req.t0),
      });
    }
    reply.code(status).send({ error: status >= 500 ? (GENERIC[status] ?? "internal server error") : "bad request" });
  });
  app.setNotFoundHandler((_req, reply) => reply.code(404).send({ error: "not found" }));
  app.addHook("onClose", async () => {
    for (const t of ctx.timers) clearTimeout(t);
  });

  await adminRoutes(app, ctx);
  await (opts.cfg.role === "shop" ? shopRoutes(app, ctx) : upstreamRoutes(app, ctx));
  return { app, ctx };
}
