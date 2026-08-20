"use client";
import { useCallback, useEffect, useState } from "react";
import type { LearningSummary } from "@/lib/corpus/summary";
import type { GuidanceClaim } from "@/lib/corpus/ledger-types";
import PageHeader from "@/components/ui/PageHeader";
import Card from "@/components/ui/Card";
import Chip from "@/components/ui/Chip";
import Button from "@/components/ui/Button";
import Skeleton from "@/components/ui/Skeleton";
import EmptyState from "@/components/ui/EmptyState";
import { toast } from "@/components/ui/Toast";

// What the copy engine has learned — the inspector for the recursive learning
// framework (docs/RECURSIVE_LEARNING_FRAMEWORK_SPEC.md §2.7, §4).
//
// Three questions, in the order a writer asks them:
//   1. What copy does it know about, and how much authority does each piece have?
//   2. What is it going to do differently on the next send? (the form budget)
//   3. What does it currently believe about performance, on what evidence, and what
//      has it stopped believing?

const money2 = (n: number) =>
  new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", minimumFractionDigits: 2 }).format(n);

const TIER_TONE = { shipped: "accent", approved: "warning", drafted: "muted" } as const;

function TierStat({ label, value, hint }: { label: string; value: number | string; hint: string }) {
  return (
    <div>
      <div className="t-label text-ink-secondary">{label}</div>
      <div className="text-2xl text-ink font-semibold tabular-nums mt-0.5">{value}</div>
      <div className="text-[11px] text-ink-muted mt-0.5 leading-snug">{hint}</div>
    </div>
  );
}

function ClaimRow({ claim }: { claim: GuidanceClaim }) {
  const tone = claim.status === "active" ? "accent" : claim.status === "weakened" ? "warning" : "muted";
  return (
    <li className="py-3 border-b border-line last:border-0">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="text-sm text-ink">{claim.claim}</div>
          {/* Every claim carries its n and its date range — the acceptance
              criterion, and the only way a human can weigh it. */}
          <div className="text-[11px] text-ink-muted mt-1">
            n={claim.n} sends · {claim.range.start} to {claim.range.end} · {claim.basis} basis ·{" "}
            {money2(claim.pooled_rpr)} per recipient (pooled)
          </div>
          <div className="text-[11px] text-ink-muted mt-0.5">
            first asserted {claim.first_asserted.slice(0, 10)} · checked {claim.checks}× ·{" "}
            replicated {claim.replications}× · failed {claim.failures}×
            {claim.status === "retired" && ` · retired ${claim.last_checked.slice(0, 10)}`}
          </div>
          {claim.history.length > 1 && (
            <div className="text-[11px] text-ink-muted mt-1">
              last check: {claim.history[claim.history.length - 1].outcome.replace(/_/g, " ")}
              {claim.history[claim.history.length - 1].note ? ` (${claim.history[claim.history.length - 1].note})` : ""}
            </div>
          )}
        </div>
        <Chip tone={tone} dot>{claim.status}</Chip>
      </div>
    </li>
  );
}

export default function LearningPage() {
  const [data, setData] = useState<LearningSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<"rebuild" | "evaluate" | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/learning");
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || "Failed to load");
      setData(json as LearningSummary);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Load failed");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  const run = async (action: "rebuild" | "evaluate") => {
    setBusy(action);
    try {
      const res = await fetch("/api/learning", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || "Failed");
      setData(json as LearningSummary);
      toast.success(action === "rebuild" ? "Corpus rebuilt from the planner, library and SMS stores" : "Guidance re-checked against the latest sends");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed");
    } finally {
      setBusy(null);
    }
  };

  const budget = data?.form_budget;
  const active = data?.ledger.claims.filter((c) => c.status === "active") ?? [];
  const retired = data?.ledger.claims.filter((c) => c.status !== "active") ?? [];

  return (
    <div className="p-8 space-y-6 max-w-5xl">
      <PageHeader
        eyebrow="Copy engine"
        title="What it has"
        accent="learned"
        description="The tiered copy corpus behind every generation: what repels the next send, what rotates into its references, and what the engine currently believes about performance. Read-only — nothing here writes copy."
        meta={
          <div className="flex items-center gap-2">
            <Button variant="ghost" size="sm" onClick={() => run("rebuild")} disabled={busy !== null}>
              {busy === "rebuild" ? "Rebuilding…" : "Rebuild corpus"}
            </Button>
            <Button variant="ghost" size="sm" onClick={() => run("evaluate")} disabled={busy !== null}>
              {busy === "evaluate" ? "Checking…" : "Re-check guidance"}
            </Button>
          </div>
        }
      />

      {loading && <Skeleton className="h-40 w-full" />}
      {error && <EmptyState title="Couldn't load the corpus" description={error} />}

      {data && !loading && (
        <>
          {/* 1 — what it knows about, and with how much authority */}
          <Card
            title="The corpus"
            subtitle={
              data.corpus.built_at
                ? `Rebuilt ${new Date(data.corpus.built_at).toLocaleString()}`
                : "Not built yet — it builds itself on the next generation"
            }
          >
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-6">
              <TierStat label="Shipped" value={data.corpus.shipped}
                hint="Scheduled and the send date has passed. The only tier performance can come from." />
              <TierStat label="In flight" value={data.corpus.approved}
                hint="Scheduled, not yet sent. Repelled from hardest — an echo here reads as a duplicate send." />
              <TierStat label="Draft only" value={data.corpus.drafted}
                hint="Written but never scheduled. Weakest signal; repels at reduced weight, never attracts." />
              <TierStat label="Measured" value={`${data.corpus.measured} / ${data.corpus.floor}`}
                hint="Shipped sends with metrics. Performance guidance stays off below the floor." />
            </div>
            <div className="mt-5 pt-4 border-t border-line text-sm text-ink-secondary">
              {data.corpus.attraction_eligible ? (
                <>Performance guidance is <span className="text-ink">on</span>: {data.corpus.measured} measured sends clears the floor of {data.corpus.floor}.</>
              ) : (
                <>Performance guidance is <span className="text-ink">off</span>: {data.corpus.measured} measured sends is below the floor of {data.corpus.floor}. Repetition avoidance is running regardless — it is useful from the first record, and performance guidance is not.</>
              )}
            </div>
          </Card>

          {/* 2 — what changes on the next send */}
          <Card title="Form budget" subtitle={`Headline patterns across the last ${budget?.counted ?? 0} approved sends`}>
            {!budget?.counted ? (
              <div className="text-sm text-ink-muted">
                No approved send carries a classified headline pattern yet, so the next send is unconstrained.
              </div>
            ) : (
              <>
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
                  {(Object.keys(budget.counts) as (keyof typeof budget.counts)[]).map((pattern) => {
                    const over = budget.over_used.includes(pattern);
                    const reach = budget.reach_for.includes(pattern);
                    return (
                      <div key={pattern} className={`rounded-md border p-3 ${over ? "border-warning-200 bg-warning-50" : reach ? "border-line-strong bg-sunken" : "border-line"}`}>
                        <div className="text-sm text-ink">{String(pattern).replace(/_/g, " ")}</div>
                        <div className="text-xl text-ink font-semibold tabular-nums">{budget.counts[pattern]}</div>
                        <div className="text-[11px] mt-0.5 text-ink-muted">
                          {over ? "over-used — not the default" : reach ? "lead with this" : "in balance"}
                        </div>
                      </div>
                    );
                  })}
                </div>
                <p className="text-[12px] text-ink-muted mt-4 leading-relaxed">
                  The slate the writer sees always carries all four patterns. The budget decides which one leads —
                  the leading candidate is what ships when nobody intervenes, so rotating it is what stops the copy
                  settling into one shape.
                </p>
              </>
            )}
          </Card>

          {/* 3 — what it believes, on what evidence */}
          <Card
            title="Guidance ledger"
            subtitle={
              data.ledger.evaluated_at
                ? `Last re-checked ${new Date(data.ledger.evaluated_at).toLocaleString()}`
                : "Never re-checked — run “Re-check guidance” to evaluate"
            }
          >
            {!data.ledger.claims.length ? (
              <div className="text-sm text-ink-muted">
                Nothing asserted yet. A claim appears once a dimension has enough sends behind it and its
                differences are wider than its internal scatter.
              </div>
            ) : (
              <>
                {active.length > 0 && (
                  <>
                    <div className="t-label text-ink-secondary mb-1">Currently believed</div>
                    <ul>{active.map((c) => <ClaimRow key={c.id} claim={c} />)}</ul>
                  </>
                )}
                {retired.length > 0 && (
                  <>
                    <div className="t-label text-ink-secondary mt-5 mb-1">Stopped believing</div>
                    <ul>{retired.map((c) => <ClaimRow key={c.id} claim={c} />)}</ul>
                  </>
                )}
                <p className="text-[12px] text-ink-muted mt-4 leading-relaxed">
                  A claim that stops being the strongest in its dimension is weakened, and stops reaching the
                  generator immediately. Two consecutive failures retire it. Nothing here ever names a headline or a
                  phrase: performance guidance may talk about angles, stages and structure, never about construction.
                </p>
              </>
            )}
          </Card>

          {/* The corpus itself, so a surprising decision can be traced to its inputs */}
          <Card title="Records" subtitle="Newest first — the copy every block above is computed from" bodyClassName="">
            {!data.records.length ? (
              <div className="p-6 text-sm text-ink-muted">The corpus is empty. It builds from the planner, the library and the SMS store.</div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="text-left text-ink-secondary">
                    <tr className="border-b border-line">
                      <th className="px-4 py-2 font-medium">Campaign</th>
                      <th className="px-4 py-2 font-medium">Tier</th>
                      <th className="px-4 py-2 font-medium">Date</th>
                      <th className="px-4 py-2 font-medium">Headline that ships</th>
                      <th className="px-4 py-2 font-medium">Construction</th>
                      <th className="px-4 py-2 font-medium text-right">RPR</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.records.map((r) => (
                      <tr key={`${r.id}-${r.channel}`} className="border-b border-line last:border-0">
                        <td className="px-4 py-2.5 text-ink max-w-[200px] truncate" title={r.title}>{r.title}</td>
                        <td className="px-4 py-2.5">
                          <Chip tone={TIER_TONE[r.tier]}>{r.tier_label}</Chip>
                        </td>
                        <td className="px-4 py-2.5 text-ink-secondary tabular-nums">{r.date || "—"}</td>
                        <td className="px-4 py-2.5 text-ink-secondary max-w-[220px] truncate" title={r.headline ?? ""}>
                          {r.headline ?? <span className="text-ink-muted">—</span>}
                        </td>
                        <td className="px-4 py-2.5 text-ink-muted text-[12px] max-w-[240px] truncate" title={r.construction ?? ""}>
                          {r.construction ?? "—"}
                        </td>
                        <td className="px-4 py-2.5 text-right tabular-nums font-mono text-[12px]">
                          {r.rpr != null ? money2(r.rpr) : <span className="text-ink-muted">—</span>}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Card>
        </>
      )}
    </div>
  );
}
