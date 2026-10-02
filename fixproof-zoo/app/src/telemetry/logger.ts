export type Severity = "INFO" | "WARNING" | "ERROR";
export interface Entry {
  severity: Severity;
  message: string;
  stack_trace?: string;
  route?: string;
  status?: number;
  latencyMs?: number;
}
export type Sink = (e: Entry) => void;
export interface Logger {
  write(e: Entry): void;
}
export function createLogger(out: (line: string) => void = (l) => console.log(l), sinks: Sink[] = []): Logger {
  return {
    write(e) {
      out(JSON.stringify(e));
      for (const s of sinks) {
        try {
          s(e);
        } catch {
          /* sinks never break the app */
        }
      }
    },
  };
}
/** Keep only app frames, drop anything that names internals of this harness. */
export function cleanStack(err: Error): string {
  const frames = (err.stack ?? "")
    .split("\n")
    .slice(1)
    .flatMap((l) => {
      const m = l.match(/at (?:(\S+) \()?.*?(app\/src\/[^:)]+):(\d+):(\d+)\)?/);
      if (!m || /\/faults\/|\.test\./.test(m[2])) return [];
      return [`    at ${m[1] ? m[1] + " " : ""}(${m[2]}:${m[3]}:${m[4]})`];
    });
  return [`${err.name}: ${err.message}`, ...frames].join("\n");
}
