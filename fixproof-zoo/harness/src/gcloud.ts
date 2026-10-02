import { execFile } from "node:child_process";
import { promisify } from "node:util";
const exec = promisify(execFile);
export const PROJECT = process.env.GCP_PROJECT ?? "fixproof-zoo-sandbox";
export const REGION = process.env.GCP_REGION ?? "us-central1";
const g = async (args: string[]) => (await exec("gcloud", [...args, `--project=${PROJECT}`], { maxBuffer: 10 << 20 })).stdout;

export async function serving(service = "zoo-shop") {
  const svc = JSON.parse(await g(["run", "services", "describe", service, `--region=${REGION}`, "--format=json"]));
  const latest: string = svc.status.latestReadyRevisionName;
  const rev = JSON.parse(await g(["run", "revisions", "describe", latest, `--region=${REGION}`, "--format=json"]));
  const created = Date.parse(rev.metadata.creationTimestamp);
  const traffic: { revisionName?: string; percent: number; latestRevision?: boolean }[] = svc.status.traffic ?? [];
  const onLatest = traffic.filter((t) => t.revisionName === latest || t.latestRevision).reduce((a, t) => a + t.percent, 0);
  return { revision: latest, ageMinutes: (Date.now() - created) / 60000, percentOnLatest: onLatest };
}
export async function updateEnv(service: string, env: Record<string, string | number>) {
  const kv = Object.entries(env).map(([k, v]) => `${k}=${v}`).join(",");
  await g(["run", "services", "update", service, `--region=${REGION}`, `--update-env-vars=${kv}`]);
}
