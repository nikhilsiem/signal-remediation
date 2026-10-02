import { z } from "zod";

/** The only file that knows Fixproof's response shape. Field names are assumptions until a real response is supplied. */
const Raw = z.object({
  id: z.string(),
  service: z.string(),
  createdAt: z.string(),
  level: z.string().optional(),
  tier: z.string().optional(),
  status: z.string().optional(),
  diagnosis: z.object({ component: z.string().optional(), summary: z.string().optional() }).nullable().optional(),
  action: z.object({ id: z.string(), status: z.string().optional() }).nullable().optional(),
  verification: z.object({ status: z.string() }).nullable().optional(),
  pr: z.object({ url: z.string(), branch: z.string(), draft: z.boolean(), files: z.array(z.string()), ciStatus: z.string() }).nullable().optional(),
});
export interface Incident {
  id: string;
  service: string;
  createdAtMs: number;
  level: string;
  tier: string;
  awaitingApproval: boolean;
  component?: string;
  diagnosis?: string;
  action: string | null;
  verification: "success" | "failure" | "none";
  pr?: { url: string; branch: string; draft: boolean; files: string[]; ciStatus: string };
}
export function mapIncident(raw: unknown): Incident {
  const r = Raw.safeParse(raw);
  if (!r.success) {
    const miss = r.error.issues.map((i) => `${i.path.join(".") || "(root)"}: ${i.message}`).join("; ");
    throw new Error(`Fixproof incident response is missing or malformed fields: ${miss}`);
  }
  const d = r.data;
  const v = d.verification?.status;
  return {
    id: d.id,
    service: d.service,
    createdAtMs: Date.parse(d.createdAt),
    level: d.level ?? "unknown",
    tier: d.tier ?? "NONE",
    awaitingApproval: d.status === "awaiting_approval",
    component: d.diagnosis?.component,
    diagnosis: d.diagnosis?.summary,
    action: d.action?.id ?? null,
    verification: v === "success" || v === "failure" ? v : "none",
    pr: d.pr ?? undefined,
  };
}

export class FixproofClient {
  private base: string;
  private token: string;
  private fetcher: typeof fetch;
  constructor(base = process.env.FIXPROOF_API_URL ?? "", token = process.env.FIXPROOF_API_TOKEN ?? "", fetcher: typeof fetch = fetch) {
    if (!base) throw new Error("FIXPROOF_API_URL is not set");
    this.base = base;
    this.token = token;
    this.fetcher = fetcher;
  }
  private async call(path: string, method = "GET") {
    const r = await this.fetcher(this.base.replace(/\/$/, "") + path, { method, headers: { authorization: `Bearer ${this.token}` } });
    if (!r.ok) throw new Error(`Fixproof ${method} ${path} -> ${r.status}`);
    return r.json() as Promise<any>;
  }
  async findIncident(sinceMs: number, service = "zoo-shop"): Promise<Incident | null> {
    const list = await this.call("/api/incidents");
    const items: unknown[] = Array.isArray(list) ? list : (list.incidents ?? list.items ?? []);
    const found = items.map(mapIncident).filter((i) => i.service === service && i.createdAtMs >= sinceMs);
    if (!found.length) return null;
    found.sort((a, b) => a.createdAtMs - b.createdAtMs);
    return mapIncident(await this.call(`/api/incidents/${found[0].id}`));
  }
  approve(id: string) {
    return this.call(`/api/incidents/${id}/approve`, "POST");
  }
}
