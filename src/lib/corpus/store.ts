// The corpus store + the guidance ledger store, on the existing storage seam
// (src/lib/storage.ts), namespace "corpus". Spec §2.5.
//
// Both are DERIVED stores: the corpus is rebuildable from the planner + library +
// saved campaigns, and the ledger is re-derivable from the corpus. A lost write
// costs a rebuild, never copy — so reads are defensive (a corrupt blob is treated
// as empty and overwritten on the next rebuild), exactly like the constructions
// index.

import path from "path";
import { getAdapter } from "../storage";
import { parseCorpusRecords, parseGuidanceClaims, stampAll } from "../validation";
import type { Corpus, CorpusRecord } from "./types";
import { EMPTY_CORPUS } from "./types";
import type { GuidanceLedger } from "./ledger-types";
import { EMPTY_LEDGER } from "./ledger-types";

const DATA_ROOT = path.join(process.cwd(), "data");
const CORPUS_KEY = "corpus.json";
const LEDGER_KEY = "guidance-ledger.json";
const store = getAdapter(DATA_ROOT, "corpus");

export async function readCorpus(): Promise<Corpus> {
  const raw = await store.read(CORPUS_KEY);
  if (raw == null) return { ...EMPTY_CORPUS, records: [] };
  try {
    const parsed = JSON.parse(raw);
    return {
      // Validated at the read boundary: one malformed record is logged and
      // skipped, never taking down the whole corpus.
      records: parseCorpusRecords(parsed?.records),
      rotation: typeof parsed?.rotation === "number" ? parsed.rotation : 0,
      built_at: typeof parsed?.built_at === "string" ? parsed.built_at : null,
    };
  } catch {
    return { ...EMPTY_CORPUS, records: [] };
  }
}

export async function writeCorpus(corpus: Corpus): Promise<void> {
  await store.write(CORPUS_KEY, JSON.stringify({
    records: stampAll(corpus.records as unknown as object[]),
    rotation: corpus.rotation,
    built_at: corpus.built_at,
  }, null, 2));
}

/**
 * Advance (and persist) the reference-sample cursor, returning the value the
 * caller should use. This is what makes two consecutive generations of the same
 * brief see different examples (§4) — the alternative, a clock- or random-seeded
 * sample, would not be reproducible when debugging a prompt.
 *
 * Fails soft: on any store error the caller still gets a usable cursor.
 */
export async function nextRotation(): Promise<number> {
  try {
    const corpus = await readCorpus();
    const next = corpus.rotation + 1;
    await writeCorpus({ ...corpus, rotation: next });
    return next;
  } catch {
    return 0;
  }
}

export async function readLedger(): Promise<GuidanceLedger> {
  const raw = await store.read(LEDGER_KEY);
  if (raw == null) return { ...EMPTY_LEDGER, claims: [] };
  try {
    const parsed = JSON.parse(raw);
    return {
      claims: parseGuidanceClaims(parsed?.claims),
      evaluated_at: typeof parsed?.evaluated_at === "string" ? parsed.evaluated_at : null,
    };
  } catch {
    return { ...EMPTY_LEDGER, claims: [] };
  }
}

export async function writeLedger(ledger: GuidanceLedger): Promise<void> {
  await store.write(LEDGER_KEY, JSON.stringify({
    claims: stampAll(ledger.claims as unknown as object[]),
    evaluated_at: ledger.evaluated_at,
  }, null, 2));
}

/** Records by tier, for the inspector and the corpus-floor checks. */
export function tierCounts(records: CorpusRecord[]): Record<string, number> {
  const counts: Record<string, number> = { shipped: 0, approved: 0, drafted: 0, measured: 0 };
  for (const r of records) {
    counts[r.tier] = (counts[r.tier] ?? 0) + 1;
    if (r.tier === "shipped" && r.performance?.rpr != null) counts.measured += 1;
  }
  return counts;
}
