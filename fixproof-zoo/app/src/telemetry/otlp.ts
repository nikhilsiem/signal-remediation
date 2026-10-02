import type { Entry, Sink } from "./logger.ts";
const SEV = { INFO: 9, WARNING: 13, ERROR: 17 } as const;
export function parseHeaders(raw: string | undefined): Record<string, string> {
  const h: Record<string, string> = {};
  for (const kv of (raw ?? "").split(",")) {
    const i = kv.indexOf("=");
    if (i > 0) h[kv.slice(0, i).trim()] = kv.slice(i + 1).trim();
  }
  return h;
}
export function otlpSink(endpoint: string, headers: Record<string, string>, service = "zoo-shop"): Sink {
  let queue: Entry[] = [];
  const flush = () => {
    if (!queue.length) return;
    const batch = queue;
    queue = [];
    const body = {
      resourceLogs: [
        {
          resource: { attributes: [{ key: "service.name", value: { stringValue: service } }] },
          scopeLogs: [
            {
              logRecords: batch.map((e) => ({
                timeUnixNano: String(Date.now() * 1_000_000),
                severityNumber: SEV[e.severity],
                severityText: e.severity,
                body: { stringValue: e.message },
                attributes: Object.entries(e)
                  .filter(([k]) => k !== "message")
                  .map(([key, v]) => ({ key, value: { stringValue: String(v) } })),
              })),
            },
          ],
        },
      ],
    };
    fetch(endpoint.replace(/\/$/, "") + "/v1/logs", {
      method: "POST",
      headers: { "content-type": "application/json", ...headers },
      body: JSON.stringify(body),
    }).catch(() => {});
  };
  setInterval(flush, 5000).unref();
  return (e) => {
    if (queue.length < 500) queue.push(e);
  };
}
