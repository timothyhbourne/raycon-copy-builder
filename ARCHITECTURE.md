# Architecture

A one-page map of Raycon Copy Builder for a new engineer. Next.js 16 (App
Router, React 19, TypeScript `strict`), deployed on Vercel serverless.

> Next.js 16 note: the middleware convention is renamed to **`proxy`**
> (`src/proxy.ts`), and `next lint` is removed — lint runs via the ESLint CLI
> (`eslint .`). Read `node_modules/next/dist/docs/` before touching routing or
> config; this is not the Next.js in your training data.

## Routes & features

- `src/app/copy-builder` — the Copy Builder UI (email). Posts a structured
  `BriefInput` to `/api/generate`, which streams a campaign back.
- `src/app/planner` — the campaign calendar; CRUD via `/api/planner*`, revenue
  via the sync route + Northbeam.
- `src/app/dashboard` — Klaviyo/Northbeam analytics (the clean, split module the
  larger pages are modeled on: `types.ts` / `format.ts` / context / layout).
- `src/app/reports`, `src/app/promotions`, `src/app/sandbox` — weekly reports,
  the promo calendar, and diagnostic probes (sandbox is dev-only).

## Auth model

A single shared credential behind an HMAC-signed HttpOnly cookie
(`src/lib/auth.ts`). The app-wide gate is `src/proxy.ts`, which **fails closed**:
`/api/*` returns 401 without a valid cookie, pages redirect to `/login`. Cron
routes (`/api/metrics/sync`, `/api/reports/weekly/run`) take dual auth — the
shared `CRON_SECRET` (constant-time compared via `safeEqual`) **or** the login
cookie. The session token is a static HMAC of the username (no per-session
revocation before expiry — a documented tradeoff, fine for one internal user).

## Storage seam

`src/lib/storage.ts` is the single storage abstraction. `getAdapter(fileRoot,
namespace)` returns an **async** `StorageAdapter` (`read` / `write` / `remove` /
`list`) backed by **Upstash Redis** when its env is configured, else a local
**file** adapter. This exists because Vercel's serverless FS is read-only except
`/tmp` (and `/tmp` is per-invocation), so runtime disk writes don't persist —
anything that writes-then-reads-at-runtime must go through the seam.

Stores on the seam: `planner.ts`, `library.ts`, `sms.ts`, `campaigns.ts`
(per-file drafts), `metrics/store.ts`, `reports/weekly-store.ts`,
`constructions.ts` (writes; reads fall back to the committed baseline file when
the seam is empty).

**Read-only, intentionally NOT on the seam** (bundled content, read via `fs`):
`data.ts` (brand voice / products / copy system), `design.ts` (assets), the
committed `constructions-index.json` baseline, and the curated
`data/reviews/*.json` (the reviews cache write is a best-effort fs optimisation
by explicit choice — see `reviews/fetch.ts`).

## Validation

`src/lib/validation/` holds Zod schemas mirroring the persisted entities
(`schemas.ts`, kept in lockstep with the TS interfaces by compile-time assignable
checks). Every storage **read** parses through a schema and logs-and-skips a bad
record instead of crashing; legacy shapes are migrated (see `parsePlannerRow`).
Every **write** stamps `schema_version`. API request bodies are validated the
same way via `parseBody(req, schema)` (`api.ts` + `requests.ts`) — malformed
input is a generic 400, detail logged server-side only.

## Copy-generation pipeline

1. **System blocks** — brand voice + hard-rules context assembled in `data.ts`.
2. **Brief compile** — `brief/compile.ts` deterministically turns a `BriefInput`
   into an `ExpandedBrief` (send stage, urgency, honest deadline language) with
   no LLM step.
3. **Retrieval / avoid** — `constructions.ts` builds an "avoid" block from past
   campaigns so copy doesn't repeat itself.
4. **Generate** — `/api/generate` streams one creative call.
5. **Hard-rules gate** — `hard-rules-check.ts` scans the result (banned phrases,
   clichés, exclamation budget, product-name drift) and auto-fixes mechanical
   punctuation issues.

## Environment

All env reads go through `src/lib/env.ts` (`readEnv` / `requireEnv` /
`debugRoutesEnabled`) — process.env first, `.env.local` fallback (the dev host
blanks some system vars). Required keys are listed in the README.

## Tests

`vitest` unit tests are colocated as `*.test.ts` next to the deterministic core:
`brief/compile`, `hard-rules-check`, `promo/consolidate`, `promo/csv`,
`metrics/store`, `auth`, and `validation`. Run `npm test`. No test touches the
network or an LLM.
