# Raycon Copy Builder

An internal Next.js 16 (App Router, React 19, TypeScript `strict`) tool for the
Raycon marketing team. It has four surfaces:

- **Copy Builder** — LLM-generated email/SMS copy grounded in an approved-examples
  corpus and gated by a deterministic hard-rules check.
- **Planner** — a campaign calendar with per-row metadata and Northbeam revenue.
- **Dashboard** — Klaviyo / Northbeam analytics on a sync-then-read model.
- **Library / Promotions / Weekly Reports** — supporting stores.

For how it fits together (routes, the storage seam, auth, the copy pipeline,
where the tests live), read [ARCHITECTURE.md](./ARCHITECTURE.md).

## Running it

```bash
npm install
npm run dev            # http://localhost:3000
```

Quality gates (all wired into CI-style scripts):

```bash
npm run typecheck      # tsc --noEmit
npm run lint           # eslint .
npm test               # vitest run
npm run build          # next build
```

## Required environment

Put these in `.env.local` for local dev (and in the deployment environment for
prod). The dev host sometimes sets system env vars to `""`, so all env reads go
through `src/lib/env.ts`, which falls back to parsing `.env.local`.

| Variable | Purpose |
| --- | --- |
| `ANTHROPIC_API_KEY` | Copy generation (Claude). |
| `KLAVIYO_API_KEY` | Dashboard metrics sync. |
| `KLAVIYO_PLACED_ORDER_METRIC_ID` | Optional pin for the Placed Order metric. |
| `NORTHBEAM_*` | Northbeam revenue (see `src/lib/northbeam.ts`). |
| `BASIC_AUTH_USER` / `BASIC_AUTH_PASSWORD` | The single shared login. Omit both to disable the gate (local). |
| `AUTH_SECRET` | Optional dedicated cookie-signing secret (else derived from the credentials). |
| `CRON_SECRET` | Bearer secret for the metrics + weekly-report cron routes. |
| `UPSTASH_REDIS_REST_URL` / `_TOKEN` (or `KV_REST_API_URL` / `_TOKEN`) | Durable storage in prod. Absent → local file store. |
| `ENABLE_DEBUG_ROUTES` | Set (any value) to expose the sandbox / `*-debug` routes in prod. |

## Persistence

All mutable stores go through one storage seam (`src/lib/storage.ts`): Upstash
Redis when its env is present, a local JSON/file store otherwise. Seed scripts:
`npm run seed:planner`, `npm run seed:library`. See ARCHITECTURE.md for which
data lives where and why (Vercel's serverless FS is read-only except `/tmp`).

## Deploy

Deployed on Vercel serverless. `npm run build` must pass first.
