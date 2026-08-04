# Lifecycle worker (Phase 2 — fitted BG/NBD + Gamma-Gamma)

Computes a statistically-fitted **P(alive)** and **predicted CLV** per customer
from real Klaviyo `Placed Order` histories, replacing the app's transparent
Phase-1 `P(active)` proxy (see `lifecycle_scoring_model_spec.md` §7 Phase 2, §8-C).
It is a **separate Python process** (the `lifetimes` library is Python; the app
is TypeScript) — the two connect through a small JSON hand-off, not a shared
runtime.

## How it connects to the app

```
Klaviyo Placed Order events
      │  (this worker: ingest → fit BG/NBD + Gamma-Gamma)
      ▼
data/lifecycle-fitted.json   +   Redis key  lifecycle:lifecycle-fitted.json
      │  (read by src/lib/lifecycle/store.ts via the storage seam)
      ▼
service.buildLifecycleBoard → scoreProfile(input, { fittedPAlive })
      │  (the fitted P(alive) overrides the proxy; every rule is unchanged)
      ▼
GET /api/lifecycle  → the Kanban board
```

Locally the app reads `data/lifecycle-fitted.json` directly (file storage
adapter). In production the app reads Redis, so the worker also writes the same
JSON to `lifecycle:lifecycle-fitted.json` when Upstash creds are present.

## Run

```bash
cd worker/lifecycle
python3 -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt
python fit_lifecycle.py                      # reads ../../.env.local
# options:
python fit_lifecycle.py --years 2 --horizon-months 12 --max-events 200000
```

Required env (already in repo-root `.env.local`): `KLAVIYO_API_KEY`,
`KLAVIYO_PLACED_ORDER_METRIC_ID`. Optional: `UPSTASH_REDIS_REST_URL` /
`_TOKEN` (or the `KV_REST_API_*` names) to also publish to Redis for prod.

Schedule it (cron / a scheduled cloud job) to refresh the fit periodically —
weekly is plenty given Raycon's long (~420-day) repurchase cadence.

## Output shape

```json
{
  "01H...": { "p_alive": 0.873, "predicted_clv": 312.40,
              "owned_products": ["The Everyday Earbuds", "Fitness Open Earbuds"],
              "fitted_at": "2026-07-24T..Z" },
  "01J...": { "p_alive": 0.041, "owned_products": ["Pro Earbuds"], "fitted_at": "2026-07-24T..Z" }
}
```

`predicted_clv` is present only for returning customers (Gamma-Gamma is fit on
customers with ≥1 repeat and positive monetary value).

`owned_products` are the raw line-item identifiers seen in the customer's Placed
Order events — the **ownership source of truth** for product-affinity cross-sell
(decision D). The app resolves them to catalogue categories (`resolveCatalogueId`),
so exact SKU/name/handle format is fine. Confirm the event-property shape on the
first run (`extract_line_items` is tolerant but LuhenE-specific keys may differ);
the sparse `Audio` / `Home` / `PS - Interest` profile properties are only a
fallback interest signal, never the ownership source.

## Status

Written against the documented Klaviyo Events API + `lifetimes` 0.11.x. It has
**not** been run end-to-end here (needs the live account + a Python env). Sanity-
check the first run on a bounded window (e.g. `--years 1`) and reconcile a few
known customers (e.g. Ray) before wiring it into the schedule.
