import { NextRequest, NextResponse } from "next/server";
import { readCorpus, readLedger, writeLedger } from "@/lib/corpus/store";
import { rebuildCorpus } from "@/lib/corpus/ingest";
import { summarizeLearning } from "@/lib/corpus/summary";
import { evaluateLedger } from "@/lib/corpus/ledger";
import { aggregate } from "@/lib/copy-performance";
import { resolvePerformanceRecords, ymdDaysAgo } from "@/lib/performance-records";
import { LOOKBACK_DAYS } from "@/lib/performance-memory";

// The inspector behind /learning: what the recursive-learning framework holds
// (the tiered corpus + the live form budget) and what it currently believes (the
// guidance ledger). Spec: docs/RECURSIVE_LEARNING_FRAMEWORK_SPEC.md §2.7, §4.
//
//   GET                      → the summary, from whatever is stored
//   GET ?rebuild=1           → rebuild the corpus first (L1 + L2)
//   POST { action:"evaluate"}→ run L5 against the current window and persist the
//                              re-weighted ledger
//
// Read-only apart from those two explicit writes. Both are cheap store operations;
// neither calls a platform API.

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  try {
    const rebuild = new URL(req.url).searchParams.get("rebuild") === "1";
    const corpus = rebuild ? await rebuildCorpus() : await readCorpus();
    const ledger = await readLedger();
    return NextResponse.json(summarizeLearning(corpus.records, corpus.built_at, ledger));
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error("[learning]", msg);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => ({}));
    const action = (body as { action?: string }).action ?? "rebuild";

    if (action === "rebuild") {
      const corpus = await rebuildCorpus();
      const ledger = await readLedger();
      return NextResponse.json(summarizeLearning(corpus.records, corpus.built_at, ledger));
    }

    if (action === "evaluate") {
      // L5: re-check every claim against the current window, then assert whatever
      // is newly well-evidenced. The window is the same lookback the PERFORMANCE
      // block uses, so the ledger is judging the claims it actually made.
      const start = ymdDaysAgo(LOOKBACK_DAYS);
      const end = ymdDaysAgo(0);
      const records = await resolvePerformanceRecords({ start, end });
      const { aggregates } = aggregate(records, "platform");
      const previous = await readLedger();
      const next = evaluateLedger(previous, aggregates, {
        now: new Date().toISOString(),
        range: { start, end },
        basis: "platform",
      });
      await writeLedger(next);
      const corpus = await readCorpus();
      return NextResponse.json(summarizeLearning(corpus.records, corpus.built_at, next));
    }

    return NextResponse.json({ error: `Unknown action "${action}"` }, { status: 400 });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error("[learning]", msg);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
