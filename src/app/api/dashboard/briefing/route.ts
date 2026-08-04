import { NextRequest, NextResponse } from "next/server";
import { getAnthropic, FAST_MODEL } from "@/lib/anthropic";
import { fetchRangeOverview, type RangeOverview } from "@/lib/measure";
import { buildBriefingFacts, priorWindow, type ChannelScope } from "@/lib/briefing";
import { briefingSystemInstruction, buildBriefingUserPrompt } from "@/lib/prompts/briefing";
import { parseBody } from "@/lib/validation/api";
import { briefingBody } from "@/lib/validation/requests";

// On-demand dashboard briefing (spec: DASHBOARD_BRIEFING_SPEC §5). INTERPRETATION
// only: the client posts the CURRENT range's OverviewData (from its session
// cache), we fetch ONLY the prior window (graceful degrade if it fails), build a
// deterministic fact pack, and ask FAST_MODEL to narrate it — never to compute.
// Numbers come from the fact pack alone, so the prose always matches the tiles.

export const dynamic = "force-dynamic";
export const maxDuration = 30;

// Structured output so the response is guaranteed-valid JSON in the fixed shape.
const BRIEFING_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["headline", "summary", "callouts"],
  properties: {
    headline: { type: "string" },
    summary: { type: "string" },
    callouts: { type: "array", items: { type: "string" } },
  },
} as const;

interface Briefing { headline: string; summary: string; callouts: string[] }

function parseBriefing(text: string): Briefing | null {
  let raw = text.trim();
  const fenced = raw.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fenced) raw = fenced[1].trim();
  const start = raw.indexOf("{");
  const end = raw.lastIndexOf("}");
  if (start === -1 || end === -1 || end < start) return null;
  try {
    const p = JSON.parse(raw.slice(start, end + 1));
    if (typeof p?.headline !== "string" || typeof p?.summary !== "string") return null;
    const callouts = Array.isArray(p.callouts) ? p.callouts.filter((c: unknown): c is string => typeof c === "string").slice(0, 3) : [];
    return { headline: p.headline, summary: p.summary, callouts };
  } catch {
    return null;
  }
}

export async function POST(req: NextRequest) {
  try {
    const parsed = await parseBody(req, briefingBody);
    if (parsed.error) return parsed.error;
    const body = parsed.data as unknown as {
      range: { start: string; end: string };
      channel?: ChannelScope;
      current: RangeOverview;
      includePrior?: boolean;
    };
    const { range, current } = body;
    const channel: ChannelScope = body.channel ?? "all";

    // Fetch ONLY the prior window; degrade gracefully so a comparison failure
    // never sinks the briefing (spec §3).
    let prior: RangeOverview | null = null;
    if (body.includePrior !== false) {
      const pw = priorWindow(range.start, range.end);
      try {
        prior = await fetchRangeOverview(pw.start, pw.end);
      } catch (e) {
        console.warn("[dashboard/briefing] prior window fetch failed:", e instanceof Error ? e.message : e);
        prior = null;
      }
    }

    const facts = buildBriefingFacts(current, prior, channel);

    const res = await getAnthropic().messages.create({
      model: FAST_MODEL,
      max_tokens: 700,
      system: briefingSystemInstruction,
      messages: [{ role: "user", content: buildBriefingUserPrompt(facts) }],
      output_config: { format: { type: "json_schema", schema: BRIEFING_SCHEMA } },
    });
    const text = res.content
      .filter((b): b is Extract<typeof b, { type: "text" }> => b.type === "text")
      .map((b) => b.text)
      .join("");
    const briefing = parseBriefing(text);
    if (!briefing) {
      return NextResponse.json({ error: "Couldn't generate the briefing — the numbers above are still accurate." }, { status: 502 });
    }

    return NextResponse.json({
      ...briefing,
      comparison_available: facts.comparison_available,
      low_data: facts.low_data,
      warnings: facts.warnings,
      prior_range: facts.prior_range,
    });
  } catch (e) {
    console.error("[dashboard/briefing]", e instanceof Error ? e.message : e);
    return NextResponse.json({ error: "Couldn't generate the briefing — the numbers above are still accurate." }, { status: 500 });
  }
}
