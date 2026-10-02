# Fixproof Bug Zoo

A deliberately breakable shop API whose only job is to test Fixproof. No users, no real data. Each fault triggers, exposes or scores a known failure. Built from `Fixproof_Bug_Zoo_build_spec.md`.

- `app/` target app (`ZOO_ROLE=shop|upstream`), `harness/` the `zoo` CLI, `scenarios/` 12 manifests, `bugs/` seeded code bugs, `infra/` GCP scripts, `fixproof/` config to paste into Fixproof.
- Stack: Node 22, TypeScript (run natively with type stripping, no build step), pnpm, Fastify 5, vitest, zod.

## Quick start (no cloud account)

```
pnpm install
pnpm check          # lint (tsc) + all offline tests
pnpm zoo local      # shop on :8080, upstream on :8081, in-memory store; admin token local-admin
# in another terminal
pnpm zoo trigger S03 && pnpm zoo status && pnpm zoo reset
```

## Deploy to GCP (free tiers; Cloud Run scales to zero)

1. Create project `fixproof-zoo-sandbox`, attach billing, `gcloud auth login`.
2. Create a free Neon database and run `infra/schema.sql` on it.
3. `DATABASE_URL=... FIXPROOF_API_URL=... infra/setup-gcp.sh`, then `infra/deploy.sh` (both are idempotent).
4. Paste `fixproof/action-targets.json` and `fixproof/env.example` values into Fixproof. See `RUNBOOK.md`.
5. Run `infra/teardown.sh` whenever the zoo will sit unused for a week.

## Environment variables

| Variable | Used by | Purpose | Required |
| --- | --- | --- | --- |
| `ZOO_ROLE` | app | `shop` (default) or `upstream` | no |
| `ZOO_ADMIN_TOKEN` | app, CLI | Bearer token for `/admin/*`; with none set, admin is closed | yes (deployed) |
| `CACHE_INVALIDATE_TOKEN` | app | Bearer token for `/cache/invalidate` | yes for shop |
| `DATABASE_URL` | app | Neon Postgres for faults and cache; unset = in-memory | yes (deployed) |
| `UPSTREAM_URL` | app (shop) | Base URL of `zoo-upstream` | yes (deployed) |
| `FAIL_RATE`, `LATENCY_MS` | app (shop) | Deploy-time faults, default 0 | no |
| `FAULT_MEMO_MS` | app | Fault read memo, default 5000 | no |
| `BUILD_STAMP` | deploy | Bumped to force a new revision | no |
| `SENTRY_DSN` | app | Sentry sink; also `pnpm --filter @zoo/app add @sentry/node` | no |
| `OTLP_1_ENDPOINT`, `OTLP_1_HEADERS`, `OTLP_2_ENDPOINT`, `OTLP_2_HEADERS` | app | OTLP/HTTP log sinks (headers `k=v,k2=v2`) | no |
| `ZOO_SHOP_URL` | CLI | Shop URL, default `http://127.0.0.1:8080` | for cloud |
| `FIXPROOF_API_URL`, `FIXPROOF_API_TOKEN` | CLI | Fixproof API for `zoo run` | for `run` |
| `GCP_PROJECT`, `GCP_REGION` | CLI, infra | Defaults `fixproof-zoo-sandbox`, `us-central1` | no |
| `ZOO_TEST_DATABASE_URL` | tests | Also runs the Postgres store suite | no |
| `BILLING_ACCOUNT` | setup-gcp | Billing account for the $1 budget (auto-detected) | no |

## Notes and known gaps

- Fix-PR repo name in `fixproof/action-targets.json` is `nikhilsiem/fixproof-zoo`; protect `main` (require `ci`) by hand on GitHub.
- Fixproof's incident field names are assumed; the mapping lives only in `harness/src/fixproof-client.ts` (fixtures in `harness/src/fixtures/`).
- Locally, `seedBug` steps (S05) are skipped since they need git push and a deploy; S01's deploy step is emulated by a local-only `/admin/local-env` route.
- OTLP sinks send logs only (no metrics). `docker build app/` and the GCP scripts have not been run against a real project.
