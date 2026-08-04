# Architecture Remediation Spec

**Status:** Ready to implement
**Owner:** Eng
**Audience:** AI code builder / any engineer picking this up
**Goal:** Take the app from "solid" to "unambiguously well-built" by fixing the structural issues found in the July 2026 architecture audit — without regressing auth, types, or working behavior.

---

## 0. How to use this document

This is a work order, not a discussion. Each item below has: **Why**, **Files**, **Change**, and **Acceptance criteria**. Implement in phase order (P0 → P3). After each item, run the verification in that item's acceptance criteria and the global checks in §7 before moving on. Do **not** batch unrelated items into one commit — one item, one focused change set.

If a change would alter externally observable behavior (an API response shape, an auth outcome, a persisted data format), call it out in the PR description and preserve backward compatibility unless the item explicitly says otherwise.

---

## 1. App context (so changes stay in-grain)

Raycon Copy Builder is an internal Next.js 16 (App Router, React 19, TypeScript `strict`) tool for the marketing team:

- **Copy Builder** — LLM-generated email/SMS copy grounded in an approved-examples corpus and a hard-rules gate.
- **Planner** — campaign calendar with per-row metadata and Northbeam revenue.
- **Dashboard** — Klaviyo/Northbeam analytics (sync-then-read model).
- **Library / Promotions / Weekly Reports** — supporting stores.

Deployment target is **Vercel serverless**. Persistence is a mix of local JSON files and **Upstash Redis** (via `@upstash/redis`). Auth is a single shared credential behind an HMAC-signed cookie, enforced by an app-wide gate.

---

## 2. Ground rules (global constraints — do not violate)

1. **This is Next.js 16, not the Next.js in your training data.** The middleware convention is renamed to `proxy` (see `src/proxy.ts` and `node_modules/next/dist/docs/`). Read the relevant doc before touching routing, middleware, or config. Do not rename `proxy` back to `middleware`.
2. **Keep TypeScript `strict`.** Do not add `any`, `@ts-ignore`, or `@ts-nocheck` to make things compile. If a type is hard, model it correctly.
3. **Do not weaken auth.** The proxy must keep failing *closed* (401 for `/api/*`, redirect for pages). Cron routes must keep their dual auth (shared secret OR login cookie).
4. **Never expose secrets.** No API key may be returned to the client, logged, or embedded in a response. No `process.env` reads in `"use client"` files.
5. **Vercel FS reality:** the serverless filesystem is **read-only except `/tmp`**, and `/tmp` is per-invocation. This means *runtime writes to disk do not persist*. **Reading files that ship in the deploy bundle is fine** (they are part of the build). Scope every storage change accordingly — see §3.
6. **No new heavy dependencies** without justification. `zod` is pre-approved (used in §4). Anything else, note why in the PR.

---

## 3. P0 — Unify the storage layer

**Why:** There are currently *two* competing storage abstractions and several stores that bypass both with direct `fs` calls. On Vercel, runtime writes to disk silently no-op, so any store that writes-then-reads-back at runtime is non-durable in production. The git history shows this being patched reactively, one store at a time ("read-only FS 500s", "calendar crash on read-only filesystem"). This is the single biggest architectural inconsistency and the top confusion point for a new engineer.

### 3.1 Establish one canonical storage seam

- **Files:** `src/lib/storage.ts` (canonical), `src/lib/metrics/store.ts` (offending duplicate).
- **Change:**
  - `src/lib/storage.ts` is the **single** storage seam. Its `StorageAdapter` is **async** (`read`/`write`/`list` all return Promises), selects Upstash Redis when `redisCreds()` is present and falls back to the file adapter otherwise, and namespaces keys.
  - Delete the second, **synchronous** `StorageAdapter` + `fileAdapter` + `adapter` binding defined inside `src/lib/metrics/store.ts`. Metrics must consume `getAdapter(...)` from `src/lib/storage.ts` instead.
  - There must be exactly **one** `StorageAdapter` interface and **one** file adapter implementation in the codebase after this change.
- **Acceptance criteria:**
  - `grep -rn "StorageAdapter" src` shows the interface defined only in `src/lib/storage.ts`.
  - `grep -rn "fileAdapter\|redisAdapter" src` shows implementations only in `src/lib/storage.ts`.

### 3.2 Migrate runtime-mutable stores onto the seam

These stores **write at runtime and read the result back later** → they MUST go through `getAdapter(...)` (durable Redis in prod):

- `src/lib/metrics/store.ts` and its writer `src/lib/metrics/sync.ts` (daily snapshots + `dimensions.json`).
- `src/lib/reports/weekly-store.ts` (`STORE_PATH`).
- `src/lib/campaigns.ts` (the `generated/*.md` campaign files under `GENERATED_DIR`).
- `src/lib/constructions.ts` — the runtime **write** paths only (`addCampaign` / `removeCampaign` mutate `INDEX_PATH`; today those writes silently fail on Vercel, so the construction index drifts out of sync with the Redis-backed library on every delete).
- `src/lib/reviews/fetch.ts` — the runtime write cache (lower urgency; a failed cache write just forces a re-fetch, so this may degrade gracefully rather than move to Redis — engineer's call, but make the choice explicit in the code comment).
- The dashboard overview "L2 disk cache" (`data/cache`, currently gitignored) if it is written at runtime.

- **Change:**
  - Each store reads/writes exclusively through `getAdapter(fileRoot, namespace)` with a unique `namespace` (e.g. `metrics`, `weekly`, `campaigns`, `constructions`).
  - Because the seam is async, make the store functions async and update **all** call sites (`await`). Expect ripples: `metrics/store.ts` → `metrics/sync.ts` → `src/app/api/klaviyo/overview/route.ts`; `campaigns.ts` → its API route(s); etc.
  - Preserve existing on-disk/seed layouts and key names (e.g. `daily/YYYY-MM-DD.json`, `dimensions.json`) so existing seed scripts and Redis keys keep working.
- **Acceptance criteria:**
  - `grep -rn "readFileSync\|writeFileSync\|readdirSync\|mkdirSync" src/lib` returns matches **only** inside `src/lib/storage.ts` (the file adapter) and inside genuinely read-only loaders listed in §3.3.
  - `npm run build` passes with no type errors.
  - Manual check: with Redis env set, writing a planner row, a metrics snapshot, a weekly report, and a generated campaign, then re-reading each, all round-trip. With Redis env unset (local), the same works against the file backend.

### 3.3 Explicitly leave read-only content alone (do NOT "fix")

These read files that **ship in the deploy bundle and are never written at runtime**. Reading them via `fs` on Vercel is correct and must not be migrated to Redis:

- `src/lib/data.ts` — `brand-voice.md`, `products.md`, `copy-system.md`, `raw/...`.
- `src/lib/design.ts` — bundled product PNGs / design assets.
- `src/lib/constructions.ts` — the **read** path of the committed `data/constructions-index.json`.
- Any committed seed JSON read at runtime (e.g. `data/reviews/*.json`).

- **Change:** none, except add a one-line comment on each read-only loader stating it intentionally reads bundled static content and is exempt from the storage seam. This prevents a future "cleanup" from breaking it.
- **Acceptance criteria:** the comment exists; behavior unchanged.

---

## 4. P0 — Add tests and linting

**Why:** There are currently zero tests and no linting wired into the workflow (no `lint` script, no ESLint config at the repo root, yet `eslint-disable` comments exist). This is the first thing a reviewer checks, and the deterministic core logic is completely unguarded against regressions.

### 4.1 Wire up linting

- **Files:** `package.json`, new `eslint.config.mjs` (flat config for Next 16).
- **Change:**
  - Add ESLint with the Next.js config appropriate to this version (confirm the correct package/preset from `node_modules/next` docs — do not assume the old `.eslintrc` format).
  - Add scripts: `"lint": "next lint"` (or the flat-config equivalent this Next version ships) and `"typecheck": "tsc --noEmit"`.
  - Resolve or explicitly justify every existing `eslint-disable` comment (there are ~11, mostly `react-hooks/exhaustive-deps` in `planner/page.tsx`, `dashboard/layout.tsx`, `promotions/page.tsx`, `InputForm.tsx`, `CopyDocModal.tsx`, and `no-explicit-any` in `northbeam.ts`/`planner.ts`).
- **Acceptance criteria:** `npm run lint` and `npm run typecheck` both pass with zero errors.

### 4.2 Add a unit test harness + tests on the deterministic core

- **Files:** add `vitest` (dev dep), `vitest.config.ts`, and `*.test.ts` files colocated with the modules under test.
- **Change:** add focused unit tests (no network, no LLM calls) for the pure logic, prioritizing:
  - `src/lib/brief/compile.ts` — send-stage / urgency / deadline-language computation from dates (this drives copy correctness).
  - `src/lib/hard-rules-check.ts` — rule detection and any auto-fix logic.
  - `src/lib/promo/consolidate.ts` and `src/lib/promo/csv.ts` — parsing/consolidation.
  - `src/lib/metrics/store.ts` — daily-row summing over a range (additivity).
  - `src/lib/auth.ts` — `credentialsValid`, `tokenValid`, `makeToken` (valid, invalid, missing-secret, tampered-token cases).
  - The new validation layer from §5.
  - Add `"test": "vitest run"` to `package.json`.
- **Acceptance criteria:** `npm test` runs and passes; the six modules above have meaningful assertions (not smoke-only). Aim for the compiler and hard-rules modules to cover their main branches.

---

## 5. P1 — Validate data at the boundaries

**Why:** Persisted JSON is `JSON.parse`'d and cast to types (`as Partial<X>`, or only an `Array.isArray` check). Malformed-but-valid JSON becomes a wrongly-typed object with no error. The `any`-typed `backfillRow` / `backfillAudience` helpers in `planner.ts` show shape drift is already happening. There is also no version marker on stored blobs.

- **Files:** new `src/lib/validation/` (Zod schemas mirroring `src/lib/schemas.ts` and `src/lib/planner-types.ts`); consumers: `src/lib/library.ts`, `src/lib/planner.ts`, `src/lib/metrics/store.ts`, `src/lib/reports/weekly-store.ts`, and the API routes in §6.
- **Change:**
  - Add `zod`. Define schemas for the core persisted entities: `SavedCampaign`, `LibraryCampaign`, `PlannerRow`, `DaySnapshot`, `Dimensions`, `SmsCampaign`, weekly report rows. Keep them in lockstep with the existing TypeScript interfaces (do not fork the type definitions — infer the TS type from the schema, or add a compile-time check that they match).
  - At every storage **read** boundary, parse with the schema. On failure: log a structured warning and skip/repair the bad record rather than crashing (mirror the current graceful-degradation intent). Do not let one corrupt row take down a whole list.
  - Add a `schema_version` field to newly written blobs and a migration hook so future shape changes are explicit. Fold the existing `backfillRow`/`backfillAudience` logic into this migration path and remove their `any` types.
- **Acceptance criteria:**
  - Reading a deliberately malformed stored record (add a test fixture) yields a logged warning and a safe result, never a 500 or an uncaught throw.
  - `grep -rn ": any\|as any" src/lib/planner.ts` returns nothing.
  - New writes include `schema_version`.

---

## 6. P1 — Make API input validation consistent

**Why:** Validation is uneven. `src/app/api/planner/route.ts` validates well (name required, channel/status against allowlists) and `src/lib/library.ts` guards IDs against path traversal (`isSafeId`), but other POST/PUT handlers cast the body and trust it. There is no shared validation utility.

- **Files:** all mutating handlers under `src/app/api/**` (start with `planner/*`, `library`, `generate`, `finalize`, `sms*`, `promotions/*`, `reviews`).
- **Change:**
  - Reuse the Zod schemas from §5. Add a small helper (e.g. `parseBody(req, schema)`) that returns typed data or a `400` with a safe message.
  - Every handler that reads `await req.json()` must validate before use. Reject unknown/oversized input; keep IDs constrained to safe characters (generalize `isSafeId`).
  - Keep error responses **generic** to the client (no stack traces, no raw upstream bodies) while logging detail server-side. Audit the sandbox/debug routes here too (they currently echo raw upstream errors — see §7.4).
- **Acceptance criteria:**
  - Every `req.json()` call site is followed by schema validation.
  - Sending malformed/missing fields to each mutating route returns `400` with a generic message and no stack trace.

---

## 7. P2 — Decompose the two "god" components

**Why:** `src/app/copy-builder/page.tsx` (~1,835 lines, ~63 hooks) and `src/app/planner/page.tsx` (~1,508 lines, ~79 hooks) concentrate enormous state in single files — the hardest files to navigate here, and a sharp contrast with the cleanly-split `dashboard/` (`types.ts` / `format.ts` / context / layout), which should be the model to copy.

- **Files:** `src/app/copy-builder/page.tsx`, `src/app/planner/page.tsx` (+ new colocated files).
- **Change (behavior-preserving refactor only — no feature changes):**
  - Extract cohesive UI regions into child components.
  - Extract state clusters into custom hooks (e.g. `useCanvasDraft`, `usePlannerRows`, `useBriefForm`), or consolidate sprawling `useState` into a `useReducer` where the state is interdependent.
  - Move pure helpers into sibling modules (mirror `dashboard/format.ts`).
  - Target: no single page component over ~500 lines; each extracted piece independently readable.
- **Acceptance criteria:**
  - Neither page file exceeds ~500 lines.
  - App behavior is unchanged (manually verify the full generate → edit → save → reload cycle for Copy Builder, and row CRUD + Northbeam link for Planner).
  - No new `eslint-disable` added during the refactor; fix the `exhaustive-deps` disables properly by moving effects into the extracted hooks.

---

## 8. P2 — Centralize environment access

**Why:** `.env.local` is manually read and regex-parsed in at least four places (`src/lib/anthropic.ts`, `src/lib/northbeam.ts`, `src/app/api/metrics/sync/route.ts`, `src/app/api/reports/weekly/run/route.ts`) as a workaround for a dev environment that sets system env vars to `""`. It's duplicated and fragile.

- **Files:** new `src/lib/env.ts`; the four sites above (plus `src/lib/klaviyo.ts` for consistency).
- **Change:**
  - One `readEnv(name)` helper implementing the "process.env, falling back to parsing `.env.local`" logic exactly once, with the same try/catch (`.env.local` is absent in prod → rely on `process.env`).
  - Optionally add a typed accessor for the known keys (`ANTHROPIC_API_KEY`, `KLAVIYO_API_KEY`, `NORTHBEAM_*`, `CRON_SECRET`, `AUTH_*`, Redis creds) with clear error messages when required-but-missing.
  - Replace the four+ duplicated implementations with calls to the helper.
- **Acceptance criteria:** `grep -rn "\.env\.local" src` shows the parse logic in exactly one file. Behavior unchanged locally and in prod.

---

## 9. P3 — Lower-risk polish

Small, independent, do-anytime items.

### 9.1 Stronger IDs
- **File:** `src/lib/nanoid.ts`. Replace the `Math.random()` implementation with `crypto.randomUUID()` (or a real `nanoid`). These are entity IDs, not security tokens, so this is hardening, not a vulnerability fix. Keep the exported function name/signature stable so call sites don't change.
- **Acceptance:** IDs still slug-safe; existing stored IDs still resolve.

### 9.2 Constant-time cron-secret comparison
- **Files:** `src/app/api/metrics/sync/route.ts`, `src/app/api/reports/weekly/run/route.ts`. The secret is compared with `===`; use the `timingSafeEqual`-based `safeEqual` pattern already in `src/lib/auth.ts` (export and reuse it). Low risk, cheap correctness.
- **Acceptance:** cron auth still works with a correct secret and rejects a wrong one; comparison is constant-time.

### 9.3 Gate diagnostic surfaces out of production
- **Files:** `src/app/sandbox/*`, `src/app/api/sandbox/*`, `src/app/api/planner/northbeam-debug/route.ts`, `src/app/api/reports/weekly/debug/route.ts`, and the Sandbox nav entry in `src/components/AppNav.tsx`.
- **Change:** these are login-gated (not public) but ship to prod and return raw upstream error bodies. Put them behind an env flag (e.g. `ENABLE_DEBUG_ROUTES`) or `NODE_ENV !== "production"`, hide the Sandbox nav item in prod, and ensure they never leak raw upstream bodies to unauthenticated callers.
- **Acceptance:** with the flag off, debug/sandbox routes return `404`/`403` and the nav item is hidden; with it on (dev), they behave as today.

### 9.4 Session token note (document, optionally improve)
- **File:** `src/lib/auth.ts`. The token is a static HMAC of the username — a leaked cookie is valid until the 7-day expiry or a secret/password rotation, with no per-session revocation. Acceptable for a single-user internal tool. Add a short comment documenting this tradeoff. Improving it (per-session nonce/rotation) is optional and out of scope unless requested.

### 9.5 Replace boilerplate README + add ARCHITECTURE.md
- **Files:** `README.md` (still create-next-app boilerplate), new `ARCHITECTURE.md`.
- **Change:** write a short, real README (what the app is, how to run it, required env vars) and a one-page `ARCHITECTURE.md` covering: routes/features, the storage seam and which backend runs where, the auth model, the copy-generation pipeline (system blocks → brief compile → hard-rules gate → retrieval), and where the deterministic tests live. The rich `docs/` folder is historical prompts, not an overview — this fills that gap.
- **Acceptance:** a new engineer can run the app and understand the module map from these two files alone.

---

## 10. Global definition of done (run after every item)

- `npm run typecheck` — zero errors.
- `npm run lint` — zero errors.
- `npm test` — all pass.
- `npm run build` — succeeds.
- No new `any` / `@ts-ignore` / `eslint-disable` introduced.
- No secret is logged or returned to a client; no `process.env` in `"use client"` files.
- Auth still fails closed (spot-check: hitting an `/api/*` route without a cookie returns 401; a page redirects to `/login`).

## 11. Suggested execution order

1. **§4.1 linting + `typecheck`/`test` scripts** first — you want the safety net before refactoring.
2. **§3 storage unification** — highest structural payoff; do it before adding validation so validation lands on the unified seam.
3. **§5 data validation** → **§6 API validation** — they share the Zod schemas.
4. **§4.2 tests** — expand coverage as the above stabilizes (write tests alongside each change, not only at the end).
5. **§7 component decomposition** — large but isolated; do once behavior is test-guarded.
6. **§8 env centralization**, then **§9 polish** items in any order.

## 12. Out of scope / do not touch

- Do not change the LLM prompt content, the brand voice files, or the hard-rules copy semantics.
- Do not rename the `proxy` convention or restructure the App Router layout.
- Do not migrate read-only bundled content to Redis (see §3.3).
- Do not add auth providers, multi-tenancy, or a real database in this pass — the Redis seam is sufficient. (Note it as a future step if the data outgrows a single writer.)
