# Repositories

Signal is split across six private repositories under `nikhilsiem`. This replaces the single-monorepo layout in `PLAN.md` (see DECISIONS.md, "Repository split").

| Repo | Contains | Depends on |
|---|---|---|
| **signal-remediation** | Docs only: DESCRIPTION, PLAN, DECISIONS, REPOS, TRUST, RUNBOOK, SETUP-*, the agent prompt | none |
| **signal-core** | Shared code as one package, `@signal/core`, with subpath exports (below), plus the Prisma schema and migrations | none |
| **signal-api** | Webhook ingestion (Sentry, GCP Pub/Sub), `/slack/actions`, REST API for dashboard + mobile | `@signal/core` |
| **signal-worker** | BullMQ pipeline: filter → dedup → enrich → diagnose → score → gate → act → verify | `@signal/core` |
| **signal-dashboard** | Next.js: incidents, confidence breakdown, kill switch, allowlist view | `@signal/core/shared` only (talks to the API over REST) |
| **signal-mobile** | Expo: push registration, feed, detail, approve/reject | `@signal/core/shared` only (talks to the API over REST) |

## `@signal/core` subpaths

| Import | What | Used by |
|---|---|---|
| `@signal/core/shared` | zod contracts, env validation | everyone |
| `@signal/core/db` | Prisma client, setting keys, seed | api, worker |
| `@signal/core/agent` | pattern match, confidence scorer, gate, and (Phase 4) LLM adapters, redaction, diagnosis | worker |
| `@signal/core/connectors` | Sentry + GCP: verify, normalize, fetchContext (Phase 2) | api (verify/normalize), worker (fetchContext) |
| `@signal/core/actions` | action registry + executors (Phase 6) | worker, api (allowlist view) |
| `@signal/core/notifiers` | Slack + Expo push (Phase 7) | worker, api (Slack signature verify) |

`@prisma/client` is an *optional peer* dependency, so the dashboard and mobile app never install it.

## How versions move

1. Change a contract in **signal-core**, run its tests, then tag it: `git tag v0.2.0 && git push --tags`.
2. Bump the dependency in each app that needs it: `"@signal/core": "github:nikhilsiem/signal-core#v0.2.0"`.
3. Apps pin tags, never branches, so a core change can't silently break a deployed app.

The trade-off, accepted deliberately: one contract change is now 1 + N PRs instead of one. Keep contracts additive where possible (new optional fields) so apps can upgrade independently.

## Local development

Clone the repos side by side:

```
~/code/signal-core
~/code/signal-api
~/code/signal-worker
...
```

To work on core and an app together, temporarily link them with `pnpm link ../signal-core` in the app, then switch back to the tag before committing.

Every app repo has its own `docker-compose.yml` for what *it* needs. Api and worker share Postgres + Redis, and `signal-api` owns the compose file that starts both.
