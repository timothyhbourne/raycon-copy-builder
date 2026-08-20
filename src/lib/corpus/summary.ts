// The read model behind /api/learning and /learning: what the framework currently
// holds and currently believes. Spec §2.7 ("Log what the system believes"), §4
// ("Every claim in the guidance ledger carries its n and its date range").
//
// A learning system that cannot be inspected cannot be trusted or debugged, and the
// first time a writer disagrees with the copy they will want to see why the machine
// thinks what it thinks.

import type { CorpusRecord } from "./types";
import { CORPUS_FLOOR, TIER_LABELS, attractionSet } from "./types";
import { approvedSends, computeFormBudget, shippedHeadline } from "./blocks";
import type { FormBudget } from "./blocks";
import { describeSignature } from "./signature";
import type { GuidanceLedger } from "./ledger-types";

export interface CorpusRecordSummary {
  id: string;
  title: string;
  tier: CorpusRecord["tier"];
  tier_label: string;
  channel: "email" | "sms";
  campaign_type: string;
  date: string;
  elements: number;
  headline: string | null;
  pattern: string | null;
  construction: string | null;
  rpr: number | null;
  measured: boolean;
}

export interface LearningSummary {
  corpus: {
    built_at: string | null;
    total: number;
    shipped: number;
    approved: number;
    drafted: number;
    measured: number;
    floor: number;
    /** Whether the PERFORMANCE block is allowed to run at all. */
    attraction_eligible: boolean;
    /** How many sends carry a classified headline pattern — the population the
     * form budget is computed over. */
    classified_sends: number;
  };
  form_budget: FormBudget;
  records: CorpusRecordSummary[];
  ledger: GuidanceLedger;
}

export function summarizeRecord(record: CorpusRecord): CorpusRecordSummary {
  const headline = shippedHeadline(record);
  return {
    id: record.id,
    title: record.title,
    tier: record.tier,
    tier_label: TIER_LABELS[record.tier],
    channel: record.channel,
    campaign_type: record.campaign_type,
    date: (record.sent_at ?? record.approved_at ?? "").slice(0, 10),
    elements: record.elements.length,
    headline: headline?.text ?? null,
    pattern: headline && headline.signature.pattern !== "unclassified" ? headline.signature.pattern : null,
    construction: headline ? describeSignature(headline.signature) : null,
    rpr: record.performance?.rpr ?? null,
    measured: record.performance?.rpr != null,
  };
}

export function summarizeLearning(
  records: CorpusRecord[],
  builtAt: string | null,
  ledger: GuidanceLedger,
): LearningSummary {
  const measured = attractionSet(records).length;
  const budget = computeFormBudget(records);
  const classified = approvedSends(records).filter((r) => {
    const pattern = shippedHeadline(r)?.signature.pattern;
    return pattern && pattern !== "unclassified";
  }).length;

  return {
    corpus: {
      built_at: builtAt,
      total: records.length,
      shipped: records.filter((r) => r.tier === "shipped").length,
      approved: records.filter((r) => r.tier === "approved").length,
      drafted: records.filter((r) => r.tier === "drafted").length,
      measured,
      floor: CORPUS_FLOOR,
      attraction_eligible: measured >= CORPUS_FLOOR,
      classified_sends: classified,
    },
    form_budget: budget,
    // Newest first, and only the sends — the drafted tier is long, uninteresting,
    // and already visible in the library.
    records: [...records]
      .sort((a, b) => (b.sent_at ?? b.approved_at ?? "").localeCompare(a.sent_at ?? a.approved_at ?? ""))
      .map(summarizeRecord),
    ledger,
  };
}
