# Signal → PagerDuty+ — 2-Week MVP Task List (v2)

## Assumptions (flag anything that's wrong)

- **One monorepo, several apps** — not separate repos. Backend, worker, dashboard, and mobile live in one repository with shared types. See "Repository structure" below for why.
- **Single-tenant proof of concept.** No multi-tenant auth, billing, or connector marketplace. That buildout stays the follow-on plan once this capability is validated.
- **Three autonomy tiers are implemented, but auto-execute ships OFF.** Tiers: `AUTO_EXECUTE`, `PROPOSE_APPROVE`, `DIAGNOSE_ONLY`. Auto-execute requires a global env flag, a per-action opt-in, low blast radius, and confidence ≥ 0.90 — and everything runs in `DRY_RUN` by default. The demo default is propose + human approve.
- **2–3 allowlisted remediation actions only**, matching your own test environment. The agent never runs freeform commands.
- **Mobile is a thin approval client** (feed, detail, approve/reject, push). It is the lowest-priority app in the build order.
- Timeline assumes near-full-time focus for 2 weeks. On evenings/weekends, stretch to 3–4 weeks rather than cutting the safety work.

## Definition of done

A real or simulated alert flows end to end: ingested → filtered as important → context fetched from the source → agent proposes an allowlisted fix → confidence score computed with a visible breakdown → gate picks a tier → notification goes out (Slack + push) → on approval (or auto, if enabled) the action executes in dry-run or for real → outcome is verified → result is logged, visible in the dashboard, and fed back into future confidence scores.

---

## Repository structure

```
signal/
  apps/
    api/         # webhook ingestion, Slack interactivity, REST API for dashboard + mobile
    worker/      # queue consumers: filter → enrich → diagnose → score → gate → act → verify
    dashboard/   # Next.js: incidents, confidence breakdown, kill switch
    mobile/      # Expo: feed, detail, approve/reject, push registration
  packages/
    shared/      # zod schemas + types shared by every app (the contracts)
    db/          # Prisma schema + client
    connectors/  # sentry, gcp-logging (ingest + context fetch)
    agent/       # LLM adapter, redaction, diagnosis, confidence scoring
    actions/     # action registry + executors (dry-run first)
    notifiers/   # slack, expo push
  docs/          # PLAN.md, DESCRIPTION.md, DECISIONS.md, SETUP-*.md, TRUST.md
```

**Why a monorepo instead of 3–4 repos:** you're a solo builder. Separate repos would mean copying the alert/diagnosis types between backend, dashboard, and mobile, and coordinating releases across them. A monorepo (pnpm workspaces) gives the same separation — each app deploys independently — with one PR touching a contract and all its consumers. Splitting into separate repos later is easy if a team ever needs it; merging them back is not.

---

## Week 1 — Foundation, connectors, diagnosis, scoring, gate

### Day 1–2: Monorepo, data model, safe action allowlist
- [ ] Scaffold the pnpm workspace above; TypeScript strict, shared tsconfig, lint, vitest, `docker-compose.yml` (Postgres + Redis), `.env.example`, env validation with zod
- [ ] `packages/shared`: zod schemas for `NormalizedAlert`, `DiagnosisProposal`, `ConfidenceBreakdown`, `GateDecision`
- [ ] `packages/db`: Prisma models — Alert, Incident, Diagnosis, Remediation, Feedback, ActionStat, DeviceToken, Setting
- [ ] Pick your 2–3 allowlisted actions (e.g. Cloud Run rollback to previous revision, Cloud Run restart, cache key invalidation) and the exact targets each may touch. This list is the entire safety boundary for v1.

### Day 3–4: Connectors (how logging sources connect)
- [ ] Sentry connector: internal-integration webhook ingest with HMAC signature check on the **raw request body**, plus a context fetch (latest event + stack trace) via the Sentry REST API
- [ ] GCP connector: Cloud Logging sink → Pub/Sub → push subscription to the API, with OIDC token verification; context fetch via the Cloud Logging API (recent entries for the same resource and time window)
- [ ] Both connectors implement one interface: `normalize(raw)` and `fetchContext(alert)`
- [ ] Recorded fixtures for each source + `pnpm simulate` that replays them
- [ ] Write `docs/SETUP-sentry.md` and `docs/SETUP-gcp.md` as you build each connector, while the steps are fresh

### Day 5–6: Worker pipeline + diagnosis agent
- [ ] Worker pipeline on BullMQ: normalize → importance filter (reuse MVP rules) → dedup → enrich with context
- [ ] LLM adapter interface (Anthropic by default, swappable to an OpenAI-compatible endpoint/Ollama via env)
- [ ] **Redaction step** before any log content reaches the LLM (tokens, emails, IPs, auth headers)
- [ ] Diagnosis agent: structured output matching `DiagnosisProposal`; action chosen only from the registry, targets chosen only from the configured target list; anything else is discarded before scoring
- [ ] Treat log text as untrusted data — prompt-injection fixture in the test suite

### Day 7: Confidence score + decision gate
- [ ] Confidence = weighted blend of LLM self-confidence, pattern match, historical success rate, and evidence checks — returned as a breakdown, stored with the remediation
- [ ] Hard overrides: failed precondition → `DIAGNOSE_ONLY`; context fetch failed → confidence capped at 0.5
- [ ] Gate: below 0.60 → `DIAGNOSE_ONLY`; 0.60–0.90 or non-low blast radius → `PROPOSE_APPROVE`; ≥ 0.90 + low blast + action opt-in + global flag + circuit breaker healthy → `AUTO_EXECUTE`
- [ ] Unit tests for the scorer and every gate branch

---

## Week 2 — Actions, notifications, apps, verification

### Day 8–9: Action executors + verification
- [ ] Each action as an isolated module: `preconditions()`, `evidenceChecks()`, `execute()`, `verify()`, `rollback()` — official SDK/API calls only, no shell execution
- [ ] `DRY_RUN=true` by default; dry-run logs the exact call it would have made
- [ ] Separate credentials for reading logs vs. acting on infrastructure (least privilege)
- [ ] Post-execution verification after a configurable delay; on failure, run rollback if defined and escalate
- [ ] Circuit breaker: cap auto-executions per action/target per hour; a verified failure disables auto for that pair until manually re-enabled
- [ ] Global kill switch stored in the DB and checked before every execution

### Day 10: Notifications + approval
- [ ] Slack app: Block Kit message with diagnosis, confidence breakdown, and Approve / Reject buttons; `/slack/actions` with signature + timestamp verification; only allowlisted Slack user IDs may approve
- [ ] Expo push notifications via device-token registration
- [ ] `POST /api/remediations/:id/approve|reject` shared by Slack, dashboard, and mobile

### Day 11–12: Dashboard + mobile
- [ ] `apps/dashboard`: incident list, incident detail (timeline, evidence, confidence breakdown, tier taken, outcome), kill-switch toggle, action allowlist view
- [ ] `apps/mobile`: push registration, feed, detail, approve/reject; static bearer token auth for the MVP
- [ ] "Correct fix / wrong fix" feedback buttons in Slack and the apps, writing to `Feedback` and updating `ActionStat`

### Day 13: Demo hardening
- [ ] Demo scenarios via the simulator: (1) bad deploy → rollback proposal → approve → verified, (2) high-confidence low-risk fix with the auto flag on in dry-run, (3) unknown error → diagnose-only, (4) prompt-injection log line → no effect
- [ ] Write `docs/TRUST.md`: how decisions are made, what's allowlisted, what always needs a human click
- [ ] Walk through the full flow live with 1–2 trusted contacts in `DRY_RUN`

### Day 14: Buffer + scope retro
- [ ] Buffer — Slack signature handling, GCP OIDC verification, and IAM scoping are the likeliest slips
- [ ] Record in `docs/DECISIONS.md` what was deferred so it isn't silently assumed into scope

---

## Explicitly out of scope

- Auto-execute enabled outside dry-run for any real customer — the code path exists, the default is off
- Multi-tenant auth, billing, connector marketplace
- A learned/trained confidence model — v1 is a transparent weighted heuristic
- Connectors beyond Sentry and GCP
- Real production credentials before the trusted-contact walkthrough is done
