// L1 INGEST + L2 EXTRACT — build the tiered corpus from stores the app already
// has. Spec: docs/RECURSIVE_LEARNING_FRAMEWORK_SPEC.md §2.2, §2.4.
//
// NO PLATFORM API IS INVOLVED, by design (§5, Out of scope). The approval signal
// is PlannerRow.status: "scheduled" means a human took that copy and put it into
// the sending platform. That is why Postscript — which has no usable public
// campaign API — is covered by exactly the same mechanism as Klaviyo.
//
// Why a full rebuild rather than incremental upserts: the corpus is derived, the
// inputs are three or four store blobs, and a record's TIER changes over time
// without anything writing to it (an approved send becomes shipped when its send
// date passes). Incremental maintenance would have to re-tier everything on a
// timer anyway, so the simple thing is also the correct thing.

import { listPlannerRows } from "../planner";
import { isEffectivelySent } from "../planner-types";
import type { PlannerRow } from "../planner-types";
import { getLibraryCampaigns } from "../library";
import { loadCampaign } from "../campaigns";
import { getSmsCampaigns } from "../sms";
import type { LibraryCampaign, SavedCampaign, SmsCampaign } from "../schemas";
import { elementsFromCampaign, elementsFromLibraryCampaign } from "./extract";
import { formSignature } from "./signature";
import type { Corpus, CorpusElement, CorpusPerformance, CorpusRecord, CorpusTier } from "./types";
import { readCorpus, writeCorpus } from "./store";

function num(n: number | null | undefined): number | null {
  return typeof n === "number" && !Number.isNaN(n) ? n : null;
}

/**
 * Tier from the planner row. No row, or a row that never reached "scheduled",
 * means the copy was drafted and possibly abandoned — the weakest signal in the
 * corpus, and the only one the old constructions index (fed on "Save Final") ever
 * had.
 */
function tierOf(row: PlannerRow | undefined): CorpusTier {
  if (!row || row.status !== "scheduled") return "drafted";
  return isEffectivelySent(row) ? "shipped" : "approved";
}

/**
 * Performance, for shipped records only. Platform basis when the platform numbers
 * are there, Northbeam as the fallback basis. NO estimation and no imputation: a
 * shipped record without metrics returns null, stays in the repulsion set, and is
 * excluded from attraction (§2.2). For SMS that means a Tier-A record carries
 * performance only if someone typed the Postscript numbers in.
 */
function performanceOf(row: PlannerRow | undefined, tier: CorpusTier): CorpusPerformance | null {
  if (!row || tier !== "shipped") return null;
  const recipients = num(row.recipients);
  const platformRevenue = num(row.revenue);
  const storedRpr = num(row.revenue_per_recipient);
  const platformRpr = storedRpr ?? (platformRevenue != null && recipients && recipients > 0 ? platformRevenue / recipients : null);
  if (platformRpr != null) {
    return { recipients, revenue: platformRevenue, rpr: platformRpr, basis: "platform" };
  }
  const nbRevenue = num(row.northbeam_revenue);
  if (nbRevenue != null && recipients && recipients > 0) {
    return { recipients, revenue: nbRevenue, rpr: nbRevenue / recipients, basis: "northbeam" };
  }
  return null;
}

function sentAt(row: PlannerRow | undefined, tier: CorpusTier): string | null {
  if (!row) return null;
  if (tier === "shipped") {
    return row.klaviyo_send_time || row.postscript_send_time || row.planned_send_at || null;
  }
  return row.planned_send_at || null;
}

/**
 * PlannerRow carries no status-change history, so the closest thing to an approval
 * timestamp is the row's last write while it is scheduled. Documented
 * approximation, used only for ordering and for the ledger's date ranges.
 */
function approvedAt(row: PlannerRow | undefined): string | null {
  if (!row || row.status !== "scheduled") return null;
  return row.copy_linked_at || row.updated_at || null;
}

function platformOf(row: PlannerRow | undefined): "klaviyo" | "postscript" | null {
  if (!row) return null;
  return row.channel === "sms" ? "postscript" : "klaviyo";
}

function baseRecord(
  id: string,
  row: PlannerRow | undefined,
  elements: CorpusElement[],
  meta: {
    title: string; campaign_type: string; channel: "email" | "sms";
    audience?: string; occasion?: string; conceit?: string; products_featured?: string[];
  },
): CorpusRecord {
  const tier = tierOf(row);
  return {
    id,
    tier,
    channel: meta.channel,
    platform: platformOf(row),
    planner_row_id: row?.id ?? null,
    approved_at: approvedAt(row),
    sent_at: sentAt(row, tier),
    title: meta.title,
    campaign_type: meta.campaign_type,
    ...(meta.audience ? { audience: meta.audience } : {}),
    ...(meta.occasion ? { occasion: meta.occasion } : {}),
    ...(meta.conceit ? { conceit: meta.conceit } : {}),
    products_featured: meta.products_featured ?? [],
    elements,
    performance: performanceOf(row, tier),
  };
}

function fromLibrary(entry: LibraryCampaign, row: PlannerRow | undefined): CorpusRecord | null {
  const elements = elementsFromLibraryCampaign(entry);
  if (!elements.length) return null;
  return baseRecord(entry.id, row, elements, {
    title: entry.title || entry.id,
    campaign_type: entry.campaign_type,
    channel: "email",
    audience: entry.audience,
    conceit: entry.conceit,
    products_featured: entry.products_featured ?? [],
  });
}

function fromSaved(saved: SavedCampaign, row: PlannerRow | undefined): CorpusRecord | null {
  const elements = elementsFromCampaign(saved.campaign, saved.section_structure ?? []);
  if (!elements.length) return null;
  return baseRecord(saved.id, row, elements, {
    title: saved.campaign_name || saved.id,
    campaign_type: saved.campaign_type,
    channel: "email",
    audience: saved.audience,
    occasion: saved.occasion,
    conceit: saved.chosen_conceit?.name,
    products_featured: saved.products_featured ?? [],
  });
}

/** SMS enters the corpus through the same door. `selected_variant` is the existing
 * "what actually shipped" signal, so was_selected comes free. */
function fromSms(sms: SmsCampaign, row: PlannerRow | undefined): CorpusRecord | null {
  const elements = (sms.variants ?? [])
    .map((variant, i): CorpusElement | null => {
      const text = (variant?.text ?? "").trim();
      if (!text) return null;
      return {
        kind: "sms",
        text,
        signature: formSignature(text),
        was_selected: i === (sms.selected_variant ?? 0),
      };
    })
    .filter((e): e is CorpusElement => e !== null);
  if (!elements.length) return null;
  return baseRecord(sms.id, row, elements, {
    title: sms.name || sms.id,
    campaign_type: "sms",
    channel: "sms",
    audience: sms.brief?.audience,
    products_featured: [],
  });
}

/**
 * Build the corpus. Reads the planner, the library, the saved-campaign drafts
 * linked to scheduled rows, and the SMS store. Never throws: a store that fails to
 * read contributes nothing rather than taking the build down, because a thin
 * corpus must degrade output quality and not break generation (§4).
 */
export async function buildCorpus(): Promise<CorpusRecord[]> {
  const [rows, library, smsCampaigns] = await Promise.all([
    listPlannerRows().catch(() => [] as PlannerRow[]),
    getLibraryCampaigns().catch(() => [] as LibraryCampaign[]),
    getSmsCampaigns().catch(() => [] as SmsCampaign[]),
  ]);

  const rowById = new Map(rows.map((r) => [r.id, r]));
  const rowByCopyId = new Map(rows.filter((r) => r.copy_campaign_id).map((r) => [r.copy_campaign_id as string, r]));
  const rowFor = (copyId: string, plannerRowId?: string): PlannerRow | undefined =>
    rowByCopyId.get(copyId) ?? (plannerRowId ? rowById.get(plannerRowId) : undefined);

  const records: CorpusRecord[] = [];
  const seen = new Set<string>();

  for (const entry of library) {
    const record = fromLibrary(entry, rowFor(entry.id, entry.planner_row_id));
    if (record) { records.push(record); seen.add(entry.id); }
  }

  // Copy that is APPROVED but has no library entry — the writer scheduled it
  // straight from a draft. This is exactly Tier B, the gap that mattered most, so
  // it is worth the extra reads.
  const unseenApproved = rows.filter(
    (r) => r.status === "scheduled" && r.channel === "email" && r.copy_campaign_id && !seen.has(r.copy_campaign_id),
  );
  const saved = await Promise.all(
    unseenApproved.map((r) => loadCampaign(r.copy_campaign_id as string).catch(() => null)),
  );
  saved.forEach((s, i) => {
    if (!s) return;
    const record = fromSaved(s, unseenApproved[i]);
    if (record && !seen.has(s.id)) { records.push(record); seen.add(s.id); }
  });

  for (const sms of smsCampaigns) {
    const record = fromSms(sms, rowFor(sms.id, sms.planner_row_id));
    if (record) records.push(record);
  }

  return records;
}

/** Rebuild and persist. Preserves the rotation cursor. */
export async function rebuildCorpus(): Promise<Corpus> {
  const existing = await readCorpus();
  const records = await buildCorpus();
  const corpus: Corpus = { records, rotation: existing.rotation, built_at: new Date().toISOString() };
  await writeCorpus(corpus);
  return corpus;
}

/**
 * How long a built corpus is trusted before the next generation rebuilds it.
 * A record's TIER changes with the clock — an approved send becomes shipped the
 * moment its send time passes — so even with no writes the corpus goes stale on
 * its own. Cache-on-read, the same idiom the promo calendar uses.
 */
export const CORPUS_MAX_AGE_MS = 15 * 60 * 1000;

function ageMs(corpus: Corpus): number {
  if (!corpus.built_at) return Infinity;
  const built = new Date(corpus.built_at).getTime();
  return Number.isNaN(built) ? Infinity : Date.now() - built;
}

/**
 * The read used on the generation path. Rebuilds inline when the store is empty
 * (first run, cold Redis) or stale, else serves what is stored. Never throws —
 * every caller treats an empty corpus as "no blocks", which is the fail-open
 * contract that keeps generation working when this whole subsystem is broken.
 */
export async function corpusForGeneration(): Promise<Corpus> {
  try {
    const corpus = await readCorpus();
    if (corpus.records.length && ageMs(corpus) < CORPUS_MAX_AGE_MS) return corpus;
    return await rebuildCorpus();
  } catch (e) {
    console.warn(`[corpus] read failed, generating without corpus blocks: ${e instanceof Error ? e.message : String(e)}`);
    return { records: [], rotation: 0, built_at: null };
  }
}

/**
 * Refresh for write paths (a finalize, a planner status change). Logs and
 * swallows: a failed refresh must never fail the user's save.
 *
 * `minAgeMs` skips the rebuild when the corpus is already fresher than that. The
 * library autosave posts to /api/finalize on a debounce, so an unconditional
 * rebuild there would mean a rebuild every few seconds of typing.
 */
export async function refreshCorpusSafely(reason: string, opts: { minAgeMs?: number } = {}): Promise<void> {
  try {
    if (opts.minAgeMs != null) {
      const existing = await readCorpus();
      if (existing.records.length && ageMs(existing) < opts.minAgeMs) return;
    }
    const corpus = await rebuildCorpus();
    console.log(`[corpus] rebuilt after ${reason}: ${corpus.records.length} records`);
  } catch (e) {
    console.warn(`[corpus] rebuild after ${reason} failed: ${e instanceof Error ? e.message : String(e)}`);
  }
}
