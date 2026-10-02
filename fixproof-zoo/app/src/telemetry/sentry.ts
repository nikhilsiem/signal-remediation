import type { Sink } from "./logger.ts";
/** Needs `pnpm add @sentry/node` in app/; without it the sink stays off. */
export function sentrySink(dsn: string): Sink {
  let sentry: any;
  const spec = "@sentry/node";
  import(spec)
    .then((m) => {
      m.init({ dsn });
      sentry = m;
    })
    .catch(() => {});
  return (e) => {
    if (e.severity === "ERROR" && sentry) {
      const err = new Error(e.message);
      err.stack = e.stack_trace;
      sentry.captureException(err);
    }
  };
}
