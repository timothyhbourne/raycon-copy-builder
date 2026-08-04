#!/usr/bin/env python3
"""
Phase-2 lifecycle worker (see lifecycle_scoring_model_spec.md §7 Phase 2, §8-C).

Replaces the app's transparent Phase-1 P(active) proxy with a statistically
fitted BG/NBD "probability alive" and a Gamma-Gamma predicted CLV, computed from
REAL transaction histories rather than the stale `expected_date_of_next_order`
field (the bug that made Ray look 448 days overdue).

Pipeline:
  1. Ingest `Placed Order` events from Klaviyo (metric id from env).
  2. Build a per-customer transaction log (profile id, order date, order value).
  3. summary_data_from_transaction_data -> BG/NBD fit -> P(alive).
  4. Gamma-Gamma fit on returning customers -> predicted CLV over a horizon.
  5. Write { "<profile_id>": { p_alive, predicted_clv, fitted_at } } to
     data/lifecycle-fitted.json AND (if Upstash creds are set) to the Redis key
     the app's storage seam reads (`lifecycle:lifecycle-fitted.json`).

The Next.js serving layer reads that map and injects `p_alive` into the model
via scoreProfile(input, { fittedPAlive }). Nothing else in the app changes.

Run:
  cd worker/lifecycle && pip install -r requirements.txt
  python fit_lifecycle.py                 # reads ../../.env.local
  python fit_lifecycle.py --years 2 --horizon-months 12 --max-events 200000

Env (from repo-root .env.local or the environment):
  KLAVIYO_API_KEY                 private pk_ key (required)
  KLAVIYO_PLACED_ORDER_METRIC_ID  Placed Order metric id (required)
  UPSTASH_REDIS_REST_URL / _TOKEN optional; when set, also writes to Redis
"""

from __future__ import annotations

import argparse
import datetime as dt
import json
import os
import sys
import time
from pathlib import Path

import requests

REPO_ROOT = Path(__file__).resolve().parents[2]
ENV_FILE = REPO_ROOT / ".env.local"
OUTPUT_FILE = REPO_ROOT / "data" / "lifecycle-fitted.json"
REDIS_KEY = "lifecycle:lifecycle-fitted.json"  # matches getAdapter(_, "lifecycle") key "lifecycle-fitted.json"

KLAVIYO_BASE = "https://a.klaviyo.com/api"
KLAVIYO_REVISION = "2026-04-15"


def load_env() -> None:
    """Populate os.environ from repo-root .env.local without clobbering real env."""
    try:
        from dotenv import load_dotenv
        load_dotenv(ENV_FILE)
    except Exception:
        # Minimal fallback parser if python-dotenv is unavailable.
        if ENV_FILE.exists():
            for line in ENV_FILE.read_text().splitlines():
                line = line.strip()
                if not line or line.startswith("#") or "=" not in line:
                    continue
                k, v = line.split("=", 1)
                os.environ.setdefault(k.strip(), v.strip().strip('"').strip("'"))


def require_env(name: str) -> str:
    v = (os.environ.get(name) or "").strip()
    if not v:
        sys.exit(f"[fit_lifecycle] {name} is not set (check .env.local or the environment).")
    return v


def klaviyo_get(url: str, key: str) -> dict:
    """GET with the Klaviyo private key, honoring 429 Retry-After."""
    headers = {
        "Authorization": f"Klaviyo-API-Key {key}",
        "revision": KLAVIYO_REVISION,
        "accept": "application/json",
    }
    for attempt in range(6):
        resp = requests.get(url, headers=headers, timeout=30)
        if resp.status_code == 429:
            wait = float(resp.headers.get("Retry-After", "2"))
            time.sleep(min(wait, 30))
            continue
        resp.raise_for_status()
        return resp.json()
    raise RuntimeError("Klaviyo rate limit: exhausted retries")


def extract_line_items(props: dict) -> list[str]:
    """
    Best-effort pull of product identifiers (names/SKUs) from a Placed Order /
    Ordered Product event's properties — the OWNERSHIP source of truth for
    product-affinity (§8-D). Tolerant of the common Klaviyo/Shopify shapes; the
    exact shape on LuhenE should be confirmed on the first run (the TS side then
    resolves these to catalogue categories via resolveCatalogueId).
    """
    out: list[str] = []

    def add(v):
        if isinstance(v, str) and v.strip():
            out.append(v.strip())

    # Ordered Product: a single product per event.
    for k in ("ProductName", "product_name", "Name", "SKU", "sku", "ProductID", "product_id"):
        add(props.get(k))

    # Placed Order: list of item names/categories.
    for k in ("Items", "ItemNames", "Categories", "products", "Products", "line_items"):
        v = props.get(k)
        if isinstance(v, list):
            for item in v:
                if isinstance(item, str):
                    add(item)
                elif isinstance(item, dict):
                    for kk in ("title", "name", "Name", "product_name", "ProductName", "sku", "SKU"):
                        add(item.get(kk))

    # Shopify integration nests line items under $extra.
    extra = props.get("$extra")
    if isinstance(extra, dict):
        li = extra.get("line_items")
        if isinstance(li, list):
            for item in li:
                if isinstance(item, dict):
                    for kk in ("title", "name", "sku"):
                        add(item.get(kk))

    return list(dict.fromkeys(out))  # de-duped, order-preserving


def fetch_placed_order_events(key: str, metric_id: str, since: dt.datetime, max_events: int) -> list[dict]:
    """
    Pull Placed Order events since `since`. Returns rows of
    {customer_id, datetime, value, products}. Uses the event->profile
    relationship for the customer id, event_properties $value (falls back to
    value) for monetary, and extract_line_items for owned products.
    """
    since_iso = since.strftime("%Y-%m-%dT%H:%M:%SZ")
    flt = f'and(equals(metric_id,"{metric_id}"),greater-or-equal(datetime,{since_iso}))'
    url = (
        f"{KLAVIYO_BASE}/events/"
        f"?filter={requests.utils.quote(flt, safe='(),\"')}"
        f"&fields[event]=datetime,event_properties"
        f"&sort=datetime&page[size]=200"
    )
    rows: list[dict] = []
    while url and len(rows) < max_events:
        payload = klaviyo_get(url, key)
        for ev in payload.get("data", []):
            attrs = ev.get("attributes", {}) or {}
            rel = (((ev.get("relationships") or {}).get("profile") or {}).get("data") or {})
            customer_id = rel.get("id")
            when = attrs.get("datetime")
            props = attrs.get("event_properties") or {}
            value = props.get("$value", props.get("value"))
            if not customer_id or not when:
                continue
            try:
                val = float(value) if value is not None else 0.0
            except (TypeError, ValueError):
                val = 0.0
            rows.append({
                "customer_id": customer_id,
                "datetime": when,
                "value": val,
                "products": extract_line_items(props),
            })
        nxt = (payload.get("links") or {}).get("next")
        url = nxt
        print(f"[fit_lifecycle] fetched {len(rows)} events…", file=sys.stderr)
    return rows[:max_events]


def fit(rows: list[dict], horizon_months: int) -> dict[str, dict]:
    """Fit BG/NBD + Gamma-Gamma and return {customer_id: {p_alive, predicted_clv}}."""
    import pandas as pd
    from lifetimes import BetaGeoFitter, GammaGammaFitter
    from lifetimes.utils import summary_data_from_transaction_data

    if not rows:
        return {}

    tx = pd.DataFrame(rows)
    tx["datetime"] = pd.to_datetime(tx["datetime"], utc=True, errors="coerce")
    tx = tx.dropna(subset=["datetime"])
    observation_period_end = tx["datetime"].max()

    summary = summary_data_from_transaction_data(
        tx,
        customer_id_col="customer_id",
        datetime_col="datetime",
        monetary_value_col="value",
        observation_period_end=observation_period_end,
        freq="D",
    )

    bgf = BetaGeoFitter(penalizer_coef=0.01)
    bgf.fit(summary["frequency"], summary["recency"], summary["T"])

    p_alive = bgf.conditional_probability_alive(
        summary["frequency"], summary["recency"], summary["T"]
    )

    # Gamma-Gamma is fit only on repeat customers with positive monetary value.
    returning = summary[(summary["frequency"] > 0) & (summary["monetary_value"] > 0)]
    predicted_clv = None
    if len(returning) > 0:
        ggf = GammaGammaFitter(penalizer_coef=0.01)
        ggf.fit(returning["frequency"], returning["monetary_value"])
        predicted_clv = ggf.customer_lifetime_value(
            bgf,
            returning["frequency"],
            returning["recency"],
            returning["T"],
            returning["monetary_value"],
            time=horizon_months,   # months
            freq="D",
            discount_rate=0.01,
        )

    fitted_at = dt.datetime.now(dt.timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
    out: dict[str, dict] = {}
    for cid, pa in p_alive.items():
        entry = {"p_alive": round(float(pa), 6), "fitted_at": fitted_at}
        if predicted_clv is not None and cid in predicted_clv.index:
            entry["predicted_clv"] = round(float(predicted_clv.loc[cid]), 2)
        out[str(cid)] = entry
    return out


def write_output(fitted: dict[str, dict], owned: dict[str, list[str]]) -> None:
    # Merge order-derived ownership (§8-D) into each customer's entry. Include
    # owner-only customers too (they may lack a fitted p_alive but still inform
    # cross-sell).
    for cid, products in owned.items():
        if products:
            fitted.setdefault(cid, {})["owned_products"] = products

    OUTPUT_FILE.parent.mkdir(parents=True, exist_ok=True)
    OUTPUT_FILE.write_text(json.dumps(fitted, indent=2))
    print(f"[fit_lifecycle] wrote {len(fitted)} rows -> {OUTPUT_FILE}", file=sys.stderr)

    url = (os.environ.get("UPSTASH_REDIS_REST_URL") or os.environ.get("KV_REST_API_URL") or "").strip()
    token = (os.environ.get("UPSTASH_REDIS_REST_TOKEN") or os.environ.get("KV_REST_API_TOKEN") or "").strip()
    if url and token:
        # SET the raw JSON string under the storage-seam key (automaticDeserialization
        # is off in the app, so the value must be the JSON string itself).
        resp = requests.post(
            f"{url}/set/{requests.utils.quote(REDIS_KEY, safe='')}",
            headers={"Authorization": f"Bearer {token}"},
            data=json.dumps(fitted),
            timeout=30,
        )
        resp.raise_for_status()
        print(f"[fit_lifecycle] pushed to Redis key {REDIS_KEY}", file=sys.stderr)


def main() -> None:
    ap = argparse.ArgumentParser(description="Fit BG/NBD + Gamma-Gamma from Klaviyo Placed Order events.")
    ap.add_argument("--years", type=float, default=3.0, help="History window to ingest (default 3).")
    ap.add_argument("--horizon-months", type=int, default=12, help="Predicted-CLV horizon in months (default 12).")
    ap.add_argument("--max-events", type=int, default=200000, help="Safety cap on events fetched.")
    args = ap.parse_args()

    load_env()
    key = require_env("KLAVIYO_API_KEY")
    metric_id = require_env("KLAVIYO_PLACED_ORDER_METRIC_ID")

    since = dt.datetime.now(dt.timezone.utc) - dt.timedelta(days=int(args.years * 365))
    rows = fetch_placed_order_events(key, metric_id, since, args.max_events)
    print(f"[fit_lifecycle] {len(rows)} order events across {len({r['customer_id'] for r in rows})} customers", file=sys.stderr)

    # Accumulate order-derived ownership (§8-D) per customer.
    owned: dict[str, list[str]] = {}
    for r in rows:
        if r["products"]:
            seen = owned.setdefault(r["customer_id"], [])
            for p in r["products"]:
                if p not in seen:
                    seen.append(p)

    fitted = fit(rows, args.horizon_months)
    write_output(fitted, owned)


if __name__ == "__main__":
    main()
