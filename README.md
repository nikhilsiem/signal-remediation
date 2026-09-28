# Signal — docs

Signal ingests alerts from Sentry and GCP Cloud Logging, has an AI agent diagnose the cause, proposes a fix from a strict allowlist, scores how sure it is, and then diagnoses only, asks a human to approve, or (opt-in, low blast radius only) auto-executes.

> PagerDuty that also tries to fix the problem, and is honest about how sure it is.

This repo holds the documentation. The code lives in five sibling repos; see **[docs/REPOS.md](docs/REPOS.md)**.

| Doc | Read it for |
|---|---|
| [DESCRIPTION.md](docs/DESCRIPTION.md) | What "correct" means: pipeline, tiers, confidence formula, **non-negotiable safety rules** |
| [PLAN.md](docs/PLAN.md) | The 2-week build plan and scope |
| [REPOS.md](docs/REPOS.md) | Which repo holds what, and how shared code is versioned |
| [DECISIONS.md](docs/DECISIONS.md) | Every judgment call made while building |
| [AGENT-PROMPT.md](docs/AGENT-PROMPT.md) | The phase-by-phase build brief and the 10 acceptance scenarios |

Still to come: `TRUST.md` (plain-language "how Signal decides"), `RUNBOOK.md` (kill switch, secrets, enabling real execution), `SETUP-sentry.md`, `SETUP-gcp.md`, `SETUP-slack.md`.

## Build status

| Phase | What | Repo | State |
|---|---|---|---|
| 0 | Tooling, env validation, lint guardrails, CI | all | ✅ all six repos scaffolded |
| 1 | Contracts + Prisma schema | signal-core | ✅ |
| — | App skeletons: API (health, auth, raw body), worker (queues), dashboard (safety banner), mobile (shell) | api, worker, dashboard, mobile | ✅ |
| 2 | Connectors + fixtures + simulator | signal-core, signal-api | ⏳ next |
| 3 | Worker pipeline | signal-worker | ⏳ |
| 4 | Agent: LLM, redaction, diagnosis | signal-core | ⏳ |
| 5 | Confidence scorer + gate | signal-core | ✅ |
| 6 | Actions, verification, circuit breaker | signal-core, signal-worker | ⏳ |
| 7 | Slack, Expo push, approval API | signal-core, signal-api | ⏳ |
| 8 | Dashboard: every screen from the design, on sample data | signal-dashboard | ✅ UI · ⏳ data |
| 9 | Mobile: every screen from the design, on sample data | signal-mobile | ✅ UI · ⏳ data, push |
| 10 | Docs + demo | signal-remediation | ⏳ |
