import path from "path";
import { getAdapter } from "@/lib/storage";
import type { Promotion } from "./consolidate";
import { consolidate } from "./consolidate";
import { fetchPromoCsv } from "./fetch";

// Store for the ingested Promotional Calendar: one JSON blob behind the shared
// storage adapter (lib/storage.ts) — Redis when configured, else file-backed,
// same idiom as lib/planner.ts. On a read-only serverless FS without KV the file
// adapter degrades gracefully (read → null, write → no-op + warn) so a deploy
// never crashes; it just re-syncs on read.

const DATA_ROOT = path.join(process.cwd(), "data");
const STORE_KEY = "promo-calendar.json";
const store = getAdapter(DATA_ROOT, "promo");

export interface PromoStore {
  synced_at: string;
  promotions: Promotion[];
  warnings?: string[];
}

export async function readPromoStore(): Promise<PromoStore | null> {
  const raw = await store.read(STORE_KEY);
  if (raw == null) return null;
  try {
    const parsed = JSON.parse(raw);
    if (parsed && Array.isArray(parsed.promotions)) return parsed as PromoStore;
    return null;
  } catch {
    return null;
  }
}

export async function writePromoStore(data: PromoStore): Promise<void> {
  await store.write(STORE_KEY, JSON.stringify(data, null, 2));
}

// Fetch → parse → consolidate → persist. Shared by POST /api/promotions/sync and
// the daily-cache-on-read in GET /api/promotions.
export async function syncPromotions(): Promise<PromoStore> {
  const csv = await fetchPromoCsv();
  const { promotions, warnings } = consolidate(csv);
  const data: PromoStore = { synced_at: new Date().toISOString(), promotions, warnings };
  await writePromoStore(data);
  return data;
}

const DAY_MS = 86_400_000;
export function isStale(syncedAt: string | undefined, maxAgeMs = DAY_MS): boolean {
  if (!syncedAt) return true;
  const t = Date.parse(syncedAt);
  return !Number.isFinite(t) || Date.now() - t > maxAgeMs;
}
