# Signal — Project Description

*Read this first. It explains what the system is, why it exists, and the rules it must never break. The task plan tells you what to build in what order; this tells you what "correct" means.*

## One-liner

Signal ingests alerts and logs from monitoring sources (Sentry, GCP Cloud Logging), decides which ones matter, has an AI agent diagnose the likely cause and propose a fix from a strict allowlist, scores its confidence, and then — depending on confidence and blast radius — auto-executes the fix, asks a human to approve it in Slack or a mobile app, or only reports the diagnosis.

Think "PagerDuty that also tries to fix the problem, and is honest about how sure it is."

## The problem

Small engineering teams (5–30 people) get paged for issues where the fix is often a known, boring action — roll back the last deploy, restart a service, clear a bad cache key. Today a human wakes up, reads logs across several tools, and performs that action. Existing AI-SRE products are priced and sold for enterprises. Signal targets small teams: same value, self-serve, and trust that is earned gradually instead of demanded up front.

## Core principle

**Confidence gates autonomy.** The system starts at "diagnose only", earns "propose + human approve", and only reaches "auto-execute" for narrow, explicitly opted-in actions with low blast radius. Every tier is visible and explainable.

## Pipeline

1. **Ingest** — webhook/Pub/Sub push from a source; verify authenticity.
2. **Normalize** — convert the vendor payload to a `NormalizedAlert`.
3. **Filter + dedup** — rule-based importance (severity, keywords, core-flow tags) and fingerprint dedup within a window.
4. **Enrich** — the connector fetches recent context from the source (stack trace, recent log entries, deploy/revision info).
5. **Redact** — strip secrets and PII from the context before it goes to any LLM.
6. **Diagnose** — the agent returns a structured `DiagnosisProposal`: summary, reasoning, evidence, and *one* proposed action from the registry with a target from the configured list — or no action.
7. **Score** — compute a confidence score with a per-component breakdown.
8. **Gate** — choose a tier (below).
9. **Act / Notify** — auto-execute, or send Slack + push with Approve/Reject, or send a diagnosis-only message.
10. **Verify** — after execution, re-check health; roll back and escalate on failure.
11. **Learn** — user feedback and verified outcomes update per-action history, which feeds future confidence scores.

## Autonomy tiers

| Tier | When | What happens |
|---|---|---|
| `AUTO_EXECUTE` | confidence ≥ 0.90, action blast radius `low`, action explicitly opted in, global `AUTO_EXECUTE_ENABLED=true`, kill switch off, circuit breaker healthy | Executes, notifies, verifies |
| `PROPOSE_APPROVE` | confidence 0.60–0.90, or the action is not eligible for auto | Notifies with Approve/Reject; executes only after an authorized human approves |
| `DIAGNOSE_ONLY` | confidence < 0.60, no valid action, failed precondition, or kill switch on | Notifies with diagnosis and suggested manual steps; no action button |

Default configuration: `AUTO_EXECUTE_ENABLED=false`, `DRY_RUN=true`.

## Confidence score

Transparent weighted heuristic, not a learned model. Each component is 0–1:

```
confidence = 0.25 * llm + 0.30 * pattern + 0.25 * history + 0.20 * evidence
```

- **llm** — the model's self-reported confidence. Weighted lowest because self-reports are unreliable.
- **pattern** — 1.0 if the alert matches the action's declared trigger signature (source + message pattern + resource type), 0.5 for a partial match, 0 for none.
- **history** — smoothed success rate for this action on this target: `(verified_successes + 1) / (attempts + 2)`. No history yields a neutral 0.5.
- **evidence** — fraction of the action's `evidenceChecks()` that pass (e.g. error present in recent logs, error rate above baseline, a new revision deployed in the last 60 minutes for a rollback, target currently unhealthy).

Hard overrides, applied after scoring:
- Failed `preconditions()` → score 0, tier `DIAGNOSE_ONLY`.
- Context fetch failed or empty → score capped at 0.5.
- Proposed action not in the registry, or target not in the configured list → proposal discarded, tier `DIAGNOSE_ONLY`.

The full breakdown is stored and shown to the user. A number without an explanation is not acceptable in this product.

## Connecting sources

Every source is a connector implementing `normalize(raw)` and `fetchContext(alert)`. Confirm exact endpoints and scopes against each vendor's current documentation while building.

**Sentry**
- Create an *internal integration* in Sentry with a webhook URL pointing at the API and permission to read issues/events.
- Verify the webhook signature header using HMAC-SHA256 over the **raw request body** with the integration's client secret. (Re-serializing parsed JSON can break verification.)
- Context: fetch the latest event and stack trace for the issue via the Sentry REST API using the integration token.

**GCP Cloud Logging**
- Create a log sink (filter e.g. `severity>=ERROR` plus the resources you care about) that exports to a Pub/Sub topic; create a push subscription to the API with an OIDC service-account token.
- Verify the OIDC JWT (audience + issuer + expected service account) before processing.
- Context: query the Cloud Logging API for recent entries on the same resource and time window; for Cloud Run, also read recent revisions to detect a fresh deploy.
- Use two identities: a read-only one for logs (`roles/logging.viewer`) and a separate, narrowly scoped one for actions.

**Slack** (notifier + approval channel)
- A real Slack app with a bot token (`chat:write`) and Interactivity enabled, pointing to the API's `/slack/actions`.
- Verify `X-Slack-Signature` with the signing secret and reject stale timestamps. Only user IDs in `SLACK_APPROVER_IDS` may approve.

**Expo push** — device tokens registered by the mobile app; notifications sent via the Expo server SDK.

## Action registry

Actions are code, not prompts. Each defines: `id`, `description`, `blastRadius`, `autoExecuteAllowed`, `triggers`, `preconditions()`, `evidenceChecks()`, `execute()`, `verify()`, and optionally `rollback()`.

The LLM may only choose an `id` from the registry and a `targetId` from the configured target list. It never supplies raw resource names, commands, or arbitrary parameters. MVP actions: Cloud Run rollback to previous revision, Cloud Run restart, cache key invalidation (from a predefined key list).

## Safety principles (non-negotiable)

1. **Allowlist only.** No freeform commands, no shell execution, no arbitrary API calls from model output.
2. **Logs are untrusted input.** Log text can contain instructions aimed at the model. It is delimited as data, and proposals are validated against the registry regardless of what the model says.
3. **Redact before the LLM.** Secrets and PII never leave the process unredacted.
4. **Dry-run by default.** Real execution requires `DRY_RUN=false` explicitly.
5. **Least privilege, separated identities** for reading vs. acting.
6. **Kill switch** stored in the DB, checked before every execution.
7. **Circuit breaker** on auto-execution; a verified failure disables auto for that action/target.
8. **Everything is auditable** — every proposal, score breakdown, decision, approval, execution, and verification is stored.
9. **Fail safe.** If the LLM, a connector, or a check fails, degrade to `DIAGNOSE_ONLY`, never to action.

## Core data (Prisma, refine as needed)

- `Alert` — source, fingerprint, title, severity, importance + reason, raw and normalized payloads
- `Incident` — groups alerts by fingerprint within the dedup window
- `Diagnosis` — summary, reasoning, evidence, proposed action + target, LLM confidence, model used
- `Remediation` — tier, confidence + breakdown, status (`PENDING_APPROVAL`, `APPROVED`, `REJECTED`, `EXECUTING`, `EXECUTED`, `VERIFIED_SUCCESS`, `VERIFIED_FAILURE`, `ROLLED_BACK`), dry-run flag, approver, timestamps, result
- `Feedback` — correct/wrong verdict per remediation
- `ActionStat` — attempts and verified successes per action/target
- `DeviceToken`, `Setting` (kill switch and other flags)

## Non-goals for this MVP

Multi-tenancy, billing, a public connector marketplace, a learned confidence model, connectors beyond Sentry and GCP, and enabling auto-execute against real customer infrastructure.

## Glossary

- **Blast radius** — how much damage the action could do if wrong (`low` / `medium` / `high`). Independent of confidence.
- **Tier** — the autonomy level chosen by the gate.
- **Dry run** — the full flow runs, but executors only log what they would do.
- **Verification** — a post-action check that the underlying problem actually cleared.
