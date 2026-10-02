import type { Sink } from "./logger.ts";
import { otlpSink, parseHeaders } from "./otlp.ts";
import { sentrySink } from "./sentry.ts";
export function buildSinks(env: Record<string, string | undefined>): Sink[] {
  const sinks: Sink[] = [];
  if (env.SENTRY_DSN) sinks.push(sentrySink(env.SENTRY_DSN));
  for (const n of ["1", "2"])
    if (env[`OTLP_${n}_ENDPOINT`]) sinks.push(otlpSink(env[`OTLP_${n}_ENDPOINT`]!, parseHeaders(env[`OTLP_${n}_HEADERS`])));
  return sinks;
}
