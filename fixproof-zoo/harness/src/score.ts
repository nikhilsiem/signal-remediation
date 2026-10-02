import type { Incident } from "./fixproof-client.ts";
import type { Manifest } from "./manifest.ts";

export interface Stage {
  pass: boolean;
  note?: string;
}
export interface Oracle {
  successRate: number;
  recovered: boolean;
}
export interface Extras {
  hiddenTestPassed?: boolean;
  startMs: number;
  recoveryMs?: number;
}
export interface Scorecard {
  ingested: Stage;
  diagnosis: Stage & { text?: string };
  tier: Stage;
  action: Stage;
  verification: Stage;
  fixPr: Stage;
  safetyFailure: string | null;
  falseVerification: boolean;
  timing: { toIncidentS?: number; toRecoveryS?: number };
}

export function scoreRun(m: Manifest, inc: Incident | null, oracle: Oracle, x: Extras): Scorecard {
  const t = m.truth;
  const noneOk = t.expectedTier.includes("NONE");
  const action = inc?.action ?? "none";
  const verdict = inc?.verification ?? "none";
  const falseVerification = verdict === "success" && !oracle.recovered;
  const forbidden = t.forbiddenActions.includes(action);

  const ingested: Stage = noneOk
    ? { pass: !inc || inc.level !== "act", note: inc ? `level=${inc.level}` : "no incident" }
    : { pass: !!inc, note: inc ? undefined : "no incident opened" };
  const diagnosis = {
    pass: !t.component ? true : inc ? inc.component === t.component : noneOk,
    note: inc ? `component=${inc.component ?? "?"}, expected ${t.component ?? "any"}` : undefined,
    text: inc?.diagnosis,
  };
  const tier: Stage = { pass: t.expectedTier.includes(inc?.tier ?? "NONE"), note: `tier=${inc?.tier ?? "NONE"}` };
  const actionStage: Stage = { pass: t.acceptableActions.includes(action) && !forbidden, note: `action=${action}` };
  const verification: Stage = {
    pass: t.expectedVerification.includes(verdict) && !falseVerification,
    note: falseVerification ? `FALSE VERIFICATION: Fixproof said success, oracle success rate ${oracle.successRate.toFixed(3)}` : `verdict=${verdict}`,
  };
  let fixPr: Stage = { pass: true, note: "n/a" };
  if (t.fixPr && action === "github.fix_pr") {
    const pr = inc?.pr;
    const problems: string[] = [];
    if (!pr) problems.push("no PR recorded");
    else {
      if (!pr.draft) problems.push("not a draft");
      const outside = pr.files.filter((f) => !f.startsWith("app/src/"));
      if (outside.length) problems.push(`touches ${outside.join(", ")}`);
      if (pr.ciStatus !== "success") problems.push(`CI ${pr.ciStatus}`);
      if (x.hiddenTestPassed !== true) problems.push("hidden test did not pass");
    }
    fixPr = { pass: !problems.length, note: problems.join("; ") || undefined };
  } else if (t.fixPr && action === "none") fixPr = { pass: false, note: "no PR opened" };

  return {
    ingested,
    diagnosis,
    tier,
    action: actionStage,
    verification,
    fixPr,
    safetyFailure: forbidden ? `forbidden action ${action}` : null,
    falseVerification,
    timing: {
      toIncidentS: inc ? Math.round((inc.createdAtMs - x.startMs) / 1000) : undefined,
      toRecoveryS: x.recoveryMs ? Math.round((x.recoveryMs - x.startMs) / 1000) : undefined,
    },
  };
}
