# Decisions

Every judgment call made while building, so nothing gets silently assumed into scope. Newest at the bottom of each section.

## Repository split (overrides PLAN.md)

- **Six repos instead of one monorepo.** This was the owner's decision on 2026-09-28. PLAN.md argues for a monorepo, and the owner chose the split knowingly. The layout is `signal-remediation` (docs), `signal-core` (shared code), and `signal-api`, `signal-worker`, `signal-dashboard`, `signal-mobile`. See REPOS.md.
- **Shared code is one package, `@signal/core`, with subpath exports** (`/shared`, `/db`, `/agent`, …). It is not six separate packages. The reason: pnpm `workspace:` links between sibling packages don't survive being installed from a git URL, and one package with subpaths sidesteps that entirely.
- **Consumed as a pinned git-tag dependency** (`github:nikhilsiem/signal-core#vX.Y.Z`). This needs no registry and no publish tokens. The trade-off is that installs need GitHub access to a private repo, which is the same access a developer already has.
- **`@prisma/client` is an optional peer dependency** of core, so the dashboard and mobile app, which only use `/shared`, don't install Prisma. The Prisma schema and migrations live in core; the api and worker run `prisma generate` against it.
- **Core ships TypeScript source** (no build step). The api and worker run it with `tsx`, the dashboard uses Next's `transpilePackages`, and mobile relies on Metro's TS transform. If any consumer struggles with that, add a `tsc` build to core. That's a contained change.
- **All repos are private** until the trusted-contact walkthrough.

## Workspace (Phase 0)

- **Pinned stable majors, not the newest.** TypeScript 5.9 (not 7.x native), Prisma 6.19 (latest tag is an 8.0 RC), zod 3.25, vitest 3.2. These are well-known and well-supported by the rest of the toolchain (typescript-eslint, Next.js). Upgrade deliberately later.
- **Packages export TypeScript source** with `moduleResolution: "Bundler"`. Apps run via `tsx`, and Next.js uses `transpilePackages`. There's no build step to keep in sync (see "Repository split").
- **The "no shell" rule is enforced by lint**, not just by convention: `child_process` and `vm` imports and `eval`/`new Function` are lint errors. This was verified with a probe file.
- **Safety env flags accept only the literal strings `true`/`false`.** `DRY_RUN=no` or `AUTO_EXECUTE_ENABLED=1` fails startup rather than being guessed at.
- **Env refuses** these combinations: Slack configured without `SLACK_APPROVER_IDS`, the same credentials file for GCP read and action identities, and `LLM_PROVIDER=fake` in production.

## Contracts + DB (Phase 1)

- **`ConfidenceBreakdown` has an extra `raw` field** (the score before overrides). This lets the UI show "scored 0.78, forced to 0 because the precondition failed" instead of a bare 0. It's additive to the contract in the prompt.
- **Override codes are an enum:** `precondition_failed_score_0`, `context_missing_capped_0.5`, `no_valid_action_score_0`.
- **`ProposedAction` ids are restricted to `[a-z0-9_.-]{1,64}`** at the schema level, so a model can't smuggle a command or path through an id before registry validation even runs.
- **Added `RemediationStatus.NOT_ACTIONABLE`** as the terminal state for `DIAGNOSE_ONLY` remediations. None of the eight statuses in DESCRIPTION.md fit "nothing to do", and leaving it null would make status queries ambiguous.
- **Added an `AuditEvent` table** (append-only) to satisfy safety rule 8 without overloading `Remediation` columns.
- **`Diagnosis.rawProposal` + `discardReason`** keep what the model *tried* to propose even when it's discarded, so prompt-injection attempts are auditable.
- **`Alert @@unique([source, externalId])`** makes webhook redelivery idempotent at the DB layer.
- **`Feedback @@unique([remediationId, by])`**: one verdict per person. Changing your mind updates the row instead of double-counting.
- **Circuit-breaker state lives on `ActionStat`** (`autoDisabled*`) because it's keyed by action+target, the same as history.
- **Per-action auto opt-in lives in `Setting`** as `auto_optin:<actionId>`. The seed sets every action to opted out.

## Confidence + gate (Phase 5)

- **Scores are rounded to 4 decimal places.** Without rounding, `0.25·0.85 + 0.30·1 + 0.25·0.75 + 0.20·1` evaluates to `0.8999999999999999` and a case that is 0.90 on paper would miss the auto tier. There's a regression test for exactly this.
- **"Partial" pattern match = 2 of 3 trigger dimensions.** A source match alone scores 0 because every GCP alert matches `source=gcp`, and counting it would inflate scores for unrelated errors.
- **Evidence with zero defined checks scores 0**, not 1. Absence of evidence is not evidence.
- **History uses the spec's smoothing**, `(s+1)/(a+2)`, and rejects impossible inputs (successes > attempts, negatives, non-integers) by throwing. The pipeline catches the error and degrades to `DIAGNOSE_ONLY`.
- **High confidence + medium/high blast radius → `PROPOSE_APPROVE`.** The formula doesn't cover this case, but the gate table implies it.
- **Auto-execute needs both** the action's code-level `autoExecuteAllowed` **and** the operator's DB opt-in. This is stricter than either alone.
- **When auto is blocked, the gate lists every blocker**, not just the first, so the UI can say "disabled globally *and* not opted in".
- **Kill switch on → `DIAGNOSE_ONLY` at decision time** (per the tier table). It is *also* re-checked immediately before execution (Phase 6/7), which covers scenario 8 (an already-approved remediation).
- **Regex patterns run over at most 4,000 characters** of alert text, since alert text is untrusted and unbounded. Patterns themselves only ever come from action code.

## Environment limits (build sandbox, not product decisions)

- `prisma generate` / `migrate` could not run in the build sandbox because the Prisma engine download host is blocked there. The schema **was validated** with Prisma's official WASM schema engine (`@prisma/prisma-schema-wasm` 6.19). Run `pnpm db:generate && pnpm db:migrate` in signal-core locally to create the first migration.
- **I can't create GitHub repos from the build environment**, only push to ones that exist. The owner creates each repo empty, and I push to it.
