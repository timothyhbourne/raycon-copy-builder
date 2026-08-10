"use client";
import { useCallback, useEffect, useMemo, useState } from "react";
import type {
  Flow, FlowEmail, FlowType, GeneratedCampaign, GeneratedSection, Conceit, CampaignMeta,
} from "@/lib/schemas";
import type { FlowSplit } from "@/lib/schemas";
import { FLOW_TYPES, FLOW_TYPE_META } from "@/lib/schemas";
import { FLOW_PLAYBOOKS, scaffoldSections, DEFAULT_EMAIL_STRUCTURE } from "@/lib/flow-playbooks";
import { nanoid } from "@/lib/nanoid";
import { extractSubheaderVariants } from "@/lib/normalize-section";
import { scrubElements, scrubMeta } from "@/lib/hard-rules-client";
import CampaignCanvas from "@/components/CampaignCanvas";
import FlowMap, { SplitFork } from "./FlowMap";
import Button from "@/components/ui/Button";
import EmptyState from "@/components/ui/EmptyState";
import Modal from "@/components/ui/Modal";
import { ConfirmModal } from "@/components/ui/Modal";
import { toast } from "@/components/ui/Toast";

// The Flows builder (spec: FLOWS_COPY_ENGINE_SPEC.md, Phase 1). A dedicated home
// for authoring TRIGGERED flow copy, distinct from the campaign copy-builder:
// pick/create a flow (scaffolds the sequence from FLOW_PLAYBOOKS), pick email N,
// give it highlights, generate via the flow BRAIN (/api/flows/generate), and
// edit in the SAME canvas campaigns use. Persistence is the durable flows store.

interface FlowListItem {
  id: string;
  name: string;
  type: FlowType;
  email_count: number;
  written_count: number;
  updated_at: string;
}

interface KlaviyoFlow { id: string; name: string }

const EMPTY_META: CampaignMeta = { subject_lines: [], preview_texts: [] };

function todayYMD(): string {
  return new Date().toISOString().slice(0, 10);
}
function slugify(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 40) || "flow";
}

// A compact one-line summary of a written email, fed to the brain as sibling
// context so the sequence reads as an arc (not repeated sends).
function summarizeEmail(email: FlowEmail): string | undefined {
  if (!email.campaign) return undefined;
  const subject = email.campaign.meta?.subject_lines?.[0];
  const body = email.campaign.sections
    .map((s) => {
      const first = Object.values(s.elements).find((v) => typeof v === "string" && v.trim());
      return typeof first === "string" ? `${s.type}: ${first.trim()}` : "";
    })
    .filter(Boolean)
    .slice(0, 4)
    .join(" | ");
  return [subject ? `subject "${subject}"` : "", body].filter(Boolean).join(" — ") || undefined;
}

export default function FlowsPage() {
  const [flows, setFlows] = useState<FlowListItem[]>([]);
  const [flow, setFlow] = useState<Flow | null>(null);
  const [selectedEmailId, setSelectedEmailId] = useState<string | null>(null);
  const [generatingEmailId, setGeneratingEmailId] = useState<string | null>(null);
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [showCreate, setShowCreate] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);

  const refreshList = useCallback(async () => {
    try {
      const res = await fetch("/api/flows");
      const data = await res.json();
      setFlows(data.flows ?? []);
    } catch {
      /* list stays as-is */
    }
  }, []);

  useEffect(() => { void refreshList(); }, [refreshList]);

  const selectFlow = useCallback(async (id: string) => {
    try {
      const res = await fetch(`/api/flows?id=${encodeURIComponent(id)}`);
      if (!res.ok) throw new Error("Not found");
      const data = await res.json();
      const f: Flow = data.flow;
      setFlow(f);
      setSelectedEmailId(f.emails[0]?.id ?? null);
      setDirty(false);
    } catch {
      toast.error("Could not load that flow");
    }
  }, []);

  // ---- persistence ---------------------------------------------------------
  const persist = useCallback(async (next: Flow) => {
    setSaving(true);
    try {
      const res = await fetch("/api/flows", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...next, updated_at: new Date().toISOString() }),
      });
      if (!res.ok) throw new Error("save failed");
      setDirty(false);
      await refreshList();
    } catch {
      toast.error("Save failed — your edits are still here, try again.");
    } finally {
      setSaving(false);
    }
  }, [refreshList]);

  // ---- create --------------------------------------------------------------
  const createFlow = useCallback(async (args: { type: FlowType; name: string; goal?: string; klaviyo?: KlaviyoFlow | null }) => {
    const now = new Date().toISOString();
    const pb = FLOW_PLAYBOOKS[args.type];
    const emails: FlowEmail[] = pb.emails.map((ej) => ({
      id: nanoid(),
      position: ej.position,
      job: ej.job,
      delay: ej.delay,
      section_structure: scaffoldSections(ej.default_structure, nanoid),
      status: "empty" as const,
    }));
    const f: Flow = {
      id: `${todayYMD()}-${slugify(args.name)}-${nanoid().slice(0, 6)}`,
      name: args.name.trim() || FLOW_TYPE_META[args.type].label,
      type: args.type,
      channel: "email",
      goal: args.goal?.trim() || undefined,
      klaviyo_flow_id: args.klaviyo?.id,
      klaviyo_flow_name: args.klaviyo?.name,
      emails,
      splits: [],
      created_at: now,
      updated_at: now,
    };
    setShowCreate(false);
    setFlow(f);
    setSelectedEmailId(f.emails[0]?.id ?? null);
    await persist(f);
    toast.success(`Created "${f.name}" — ${emails.length} email${emails.length === 1 ? "" : "s"} scaffolded`);
  }, [persist]);

  const deleteFlow = useCallback(async (id: string) => {
    setConfirmDelete(null);
    await fetch(`/api/flows?id=${encodeURIComponent(id)}`, { method: "DELETE" });
    if (flow?.id === id) { setFlow(null); setSelectedEmailId(null); }
    await refreshList();
    toast.success("Flow deleted");
  }, [flow, refreshList]);

  // ---- conditional splits (Phase 2 node-map) -------------------------------
  // A new split starts with an empty label (the map drops it into edit mode);
  // we persist only once it has a real label, and on delete only if it was ever
  // saved — so an add-then-cancel never writes a stray record.
  const addSplit = useCallback((afterPosition: number) => {
    setFlow((prev) => prev ? {
      ...prev,
      splits: [...prev.splits, { id: nanoid(), after_email_position: afterPosition, label: "" }],
    } : prev);
  }, []);

  const updateSplit = useCallback((id: string, fields: Partial<Pick<FlowSplit, "label" | "yes_label" | "no_label">>) => {
    setFlow((prev) => {
      if (!prev) return prev;
      const next = { ...prev, splits: prev.splits.map((s) => (s.id === id ? { ...s, ...fields } : s)) };
      void persist(next);
      return next;
    });
  }, [persist]);

  const deleteSplit = useCallback((id: string) => {
    setFlow((prev) => {
      if (!prev) return prev;
      const existed = prev.splits.find((s) => s.id === id);
      const next = { ...prev, splits: prev.splits.filter((s) => s.id !== id) };
      if (existed?.label) void persist(next); // only persist removal of a saved split
      return next;
    });
  }, [persist]);

  const updateTrigger = useCallback((value: string) => {
    setFlow((prev) => {
      if (!prev) return prev;
      const next = { ...prev, trigger: value || undefined };
      void persist(next);
      return next;
    });
  }, [persist]);

  // ---- write one email (stream from the flow brain) ------------------------
  const selectedEmail = flow?.emails.find((e) => e.id === selectedEmailId) ?? null;

  // Apply a partial update to the selected email, in flow state.
  const updateEmail = useCallback((emailId: string, patch: Partial<FlowEmail>) => {
    setFlow((prev) => prev ? {
      ...prev,
      emails: prev.emails.map((e) => (e.id === emailId ? { ...e, ...patch } : e)),
    } : prev);
  }, []);

  // ---- add / remove emails (custom flows + extending any flow) -------------
  const addEmail = useCallback(() => {
    setFlow((prev) => {
      if (!prev) return prev;
      const position = prev.emails.length + 1;
      const email: FlowEmail = {
        id: nanoid(),
        position,
        job: "",
        delay: "Later",
        section_structure: scaffoldSections(DEFAULT_EMAIL_STRUCTURE, nanoid),
        status: "empty",
      };
      const next = { ...prev, emails: [...prev.emails, email] };
      void persist(next);
      setSelectedEmailId(email.id);
      return next;
    });
  }, [persist]);

  const deleteEmail = useCallback((emailId: string) => {
    setFlow((prev) => {
      if (!prev || prev.emails.length <= 1) return prev; // a flow keeps at least one email
      const removed = prev.emails.find((e) => e.id === emailId);
      if (!removed) return prev;
      const removedPos = removed.position;
      // Renumber the survivors 1..n by order, and re-anchor splits: drop any that
      // sat right after the removed email; shift down those anchored further along.
      const emails = prev.emails.filter((e) => e.id !== emailId).map((e, i) => ({ ...e, position: i + 1 }));
      const splits = prev.splits
        .filter((s) => s.after_email_position !== removedPos)
        .map((s) => (s.after_email_position > removedPos ? { ...s, after_email_position: s.after_email_position - 1 } : s));
      const next = { ...prev, emails, splits };
      void persist(next);
      setSelectedEmailId((cur) => (cur === emailId ? (emails[0]?.id ?? null) : cur));
      return next;
    });
  }, [persist]);

  const writeEmail = useCallback(async (email: FlowEmail) => {
    if (!flow) return;
    setGeneratingEmailId(email.id);
    const siblings = flow.emails
      .filter((e) => e.id !== email.id)
      .map((e) => ({ position: e.position, job: e.job, summary: summarizeEmail(e) }));
    const context = {
      flow_type: flow.type,
      flow_name: flow.name,
      channel: flow.channel,
      trigger: flow.trigger ?? FLOW_PLAYBOOKS[flow.type].trigger,
      goal: flow.goal,
      position: email.position,
      total_emails: flow.emails.length,
      job: email.job,
      delay: email.delay,
      highlights: email.highlights,
      siblings,
    };

    let meta = { ...EMPTY_META };
    let sections: GeneratedSection[] = [];
    // Seed the canvas so it renders live as sections stream in.
    updateEmail(email.id, { campaign: { meta, sections: [] } });

    try {
      const res = await fetch("/api/flows/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ context, section_structure: email.section_structure }),
      });
      if (!res.body) throw new Error("No response stream");
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let sseBuffer = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        sseBuffer += decoder.decode(value, { stream: true });
        const events = sseBuffer.split("\n\n");
        sseBuffer = events.pop() ?? "";
        for (const event of events) {
          const line = event.trim();
          if (!line.startsWith("data: ")) continue;
          const payload = line.slice(6).trim();
          if (payload === "[DONE]") break;
          if (!payload.startsWith("{")) continue;
          try {
            const parsed = JSON.parse(payload);
            if (parsed.error) throw new Error(parsed.error);
            if (Array.isArray(parsed.review_gaps) && parsed.review_gaps.length) {
              toast.info(`No eligible review found for ${parsed.review_gaps.map((g: { name: string }) => g.name).join(", ")} — that Review field stays empty.`);
            } else if (parsed.meta) {
              meta = scrubMeta(parsed.meta);
              updateEmail(email.id, { campaign: { meta, sections: [...sections] } });
            } else if (parsed.type) {
              const { elements, subheader_variants, subheader_selected } = extractSubheaderVariants(scrubElements(parsed.elements));
              const newSection: GeneratedSection = {
                id: nanoid(),
                type: parsed.type,
                elements,
                ...(subheader_variants ? { subheader_variants, subheader_selected } : {}),
              };
              sections = [...sections, newSection];
              updateEmail(email.id, { campaign: { meta, sections } });
            }
          } catch {
            /* ignore partial / unparseable lines */
          }
        }
      }
      // Persist the freshly written email as a draft.
      const written: GeneratedCampaign = { meta, sections };
      setFlow((prev) => {
        if (!prev) return prev;
        const next = {
          ...prev,
          emails: prev.emails.map((e) => (e.id === email.id ? { ...e, campaign: written, status: "draft" as const } : e)),
        };
        void persist(next);
        return next;
      });
      toast.success(`Email ${email.position} written — ${sections.length} section${sections.length === 1 ? "" : "s"}`);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Generation failed");
      // Roll the seeded-but-empty campaign back if nothing streamed.
      updateEmail(email.id, sections.length ? {} : { campaign: undefined });
    } finally {
      setGeneratingEmailId(null);
    }
  }, [flow, updateEmail, persist]);

  // Canvas edits → local flow state (persist via the Save button).
  const onCanvasChange = useCallback((c: GeneratedCampaign) => {
    if (!selectedEmailId) return;
    updateEmail(selectedEmailId, { campaign: c });
    setDirty(true);
  }, [selectedEmailId, updateEmail]);

  const conceit: Conceit | null = useMemo(() => {
    if (!flow || !selectedEmail) return null;
    return {
      id: selectedEmail.id,
      name: `Email ${selectedEmail.position} of ${flow.emails.length} — ${FLOW_TYPE_META[flow.type].label}`,
      description: selectedEmail.highlights?.trim() || selectedEmail.job,
    };
  }, [flow, selectedEmail]);

  return (
    <div className="rc-content-panel flex flex-1 min-h-0 overflow-hidden">
      {/* Flows list */}
      <aside className="w-72 shrink-0 border-r border-line bg-surface flex flex-col">
        <div className="px-4 pt-4 pb-3 flex items-center justify-between">
          <div className="t-label">Flows</div>
          <Button size="sm" variant="primary" onClick={() => setShowCreate(true)}>New flow</Button>
        </div>
        <div className="flex-1 overflow-y-auto px-3 pb-4 space-y-1.5">
          {flows.length === 0 && <EmptyState className="py-10" title="No flows yet" description="Create a Welcome, Abandoned Cart, or other lifecycle flow to start writing." />}
          {flows.map((item) => (
            <div
              key={item.id}
              onClick={() => selectFlow(item.id)}
              className={`group flex items-start justify-between gap-2 p-2.5 rounded-md border cursor-pointer transition-[background-color,border-color] duration-150 ${
                flow?.id === item.id
                  ? "border-accent-200 border-l-2 border-l-accent bg-accent-50"
                  : "border-line hover:border-line-strong bg-surface hover:bg-chrome"
              }`}
            >
              <div className="min-w-0">
                <div className="text-sm font-medium text-ink truncate">{item.name}</div>
                <div className="text-xs text-ink-tertiary mt-0.5">
                  {FLOW_TYPE_META[item.type]?.label ?? item.type} · {item.written_count}/{item.email_count} written
                </div>
              </div>
              <button
                onClick={(e) => { e.stopPropagation(); setConfirmDelete(item.id); }}
                aria-label="Delete flow"
                title="Delete flow"
                className="opacity-40 group-hover:opacity-100 focus-visible:opacity-100 text-ink-tertiary hover:text-danger-600 transition-opacity text-xs shrink-0 mt-0.5"
              >
                ✕
              </button>
            </div>
          ))}
        </div>
      </aside>

      {/* Node-map (Phase 2) */}
      {flow && (
        <aside className="w-80 shrink-0 border-r border-line bg-canvas overflow-y-auto">
          <FlowMap
            flow={flow}
            selectedEmailId={selectedEmailId}
            generatingEmailId={generatingEmailId}
            onSelectEmail={setSelectedEmailId}
            onAddSplit={addSplit}
            onUpdateSplit={updateSplit}
            onDeleteSplit={deleteSplit}
            onAddEmail={addEmail}
            onUpdateTrigger={updateTrigger}
          />
        </aside>
      )}

      {/* Main: the selected email's brief + canvas */}
      <main className="flex-1 overflow-y-auto">
        {!flow ? (
          <div className="h-full flex items-center justify-center">
            <EmptyState
              title="Pick a flow, or create one"
              description="Flows are triggered, evergreen sequences — Welcome, Abandoned Cart, Post-Purchase. They get their own writing brain, tuned to relationship-building rather than one-off promos."
              action={<Button variant="secondary" onClick={() => setShowCreate(true)}>New flow</Button>}
            />
          </div>
        ) : !selectedEmail ? (
          <div className="h-full flex items-center justify-center">
            <EmptyState title="Select an email" description="Choose an email from the sequence on the left to write it." />
          </div>
        ) : (
          <div className="max-w-3xl mx-auto px-6 py-6">
            {/* Brief panel */}
            <div className="bg-white border border-line rounded-lg p-5 mb-4">
              <div className="flex items-center justify-between gap-4">
                <div className="t-label">Email {selectedEmail.position} of {flow.emails.length}</div>
                <div className="flex items-center gap-2">
                  {dirty && (
                    <Button size="sm" variant="secondary" loading={saving} onClick={() => flow && persist(flow)}>Save</Button>
                  )}
                  <Button
                    size="sm"
                    variant="ghost"
                    disabled={flow.emails.length <= 1}
                    title={flow.emails.length <= 1 ? "A flow keeps at least one email" : "Delete this email"}
                    onClick={() => deleteEmail(selectedEmail.id)}
                  >
                    Delete email
                  </Button>
                </div>
              </div>

              <div className="mt-3 grid grid-cols-3 gap-3">
                <div className="col-span-1">
                  <label className="t-label block mb-1">Delay</label>
                  <input
                    value={selectedEmail.delay ?? ""}
                    onChange={(e) => { updateEmail(selectedEmail.id, { delay: e.target.value }); setDirty(true); }}
                    placeholder="e.g. 2 days later"
                    className="w-full text-sm border border-line rounded-md px-3 py-2 bg-surface focus:outline-none focus:border-accent transition-colors"
                  />
                </div>
                <div className="col-span-2">
                  <label className="t-label block mb-1">This email&apos;s job</label>
                  <input
                    value={selectedEmail.job}
                    onChange={(e) => { updateEmail(selectedEmail.id, { job: e.target.value }); setDirty(true); }}
                    placeholder="What is this email for in the sequence?"
                    className="w-full text-sm border border-line rounded-md px-3 py-2 bg-surface focus:outline-none focus:border-accent transition-colors"
                  />
                </div>
              </div>

              <div className="mt-3">
                <label className="t-label block mb-1">What should this email emphasize? (X / Y / Z)</label>
                <textarea
                  value={selectedEmail.highlights ?? ""}
                  onChange={(e) => { updateEmail(selectedEmail.id, { highlights: e.target.value }); setDirty(true); }}
                  placeholder="e.g. lead with the 6-month warranty, name the Everyday Earbuds, mention free shipping"
                  rows={2}
                  className="w-full text-sm border border-line rounded-md px-3 py-2 bg-surface focus:outline-none focus:border-accent transition-colors resize-y"
                />
              </div>
              <div className="mt-3 flex items-center gap-2">
                <Button
                  variant="primary"
                  loading={generatingEmailId === selectedEmail.id}
                  onClick={() => writeEmail(selectedEmail)}
                >
                  {selectedEmail.status === "empty" ? "Write this email" : "Rewrite"}
                </Button>
                {selectedEmail.status !== "empty" && (
                  <Button
                    variant="secondary"
                    onClick={() => {
                      const next = selectedEmail.status === "final" ? "draft" : "final";
                      updateEmail(selectedEmail.id, { status: next });
                      setFlow((prev) => { if (prev) void persist({ ...prev, emails: prev.emails.map((e) => e.id === selectedEmail.id ? { ...e, status: next } : e) }); return prev; });
                    }}
                  >
                    {selectedEmail.status === "final" ? "Mark as draft" : "Mark final"}
                  </Button>
                )}
              </div>
            </div>

            {/* Branch context — the conditional splits touching this email, shown
                in the canvas so a Yes/No fork is visible while writing. */}
            {(() => {
              const around = flow.splits.filter(
                (s) => s.label && (s.after_email_position === selectedEmail.position || s.after_email_position === selectedEmail.position - 1)
              );
              if (!around.length) return null;
              return (
                <div className="mb-4">
                  <div className="t-label mb-1.5">Branches around this email</div>
                  <div className="space-y-2">
                    {around.map((s) => (
                      <div key={s.id}>
                        <div className="text-[11px] text-ink-muted mb-1">
                          {s.after_email_position === selectedEmail.position ? "After this email" : "Leads into this email"}
                        </div>
                        <SplitFork split={s} />
                      </div>
                    ))}
                  </div>
                </div>
              );
            })()}

            {/* Canvas */}
            {selectedEmail.campaign ? (
              <CampaignCanvas
                campaign={selectedEmail.campaign}
                expandedBrief={null}
                chosenConceit={conceit}
                retrievedExamples={[]}
                sectionStructure={selectedEmail.section_structure}
                toneDial={1}
                isGenerating={generatingEmailId === selectedEmail.id}
                onChange={onCanvasChange}
              />
            ) : (
              <EmptyState
                className="border border-dashed border-line rounded-lg"
                title="Not written yet"
                description="Add any highlights above, then Write this email — the flow brain drafts it as email N of the sequence."
              />
            )}
          </div>
        )}
      </main>

      {showCreate && <CreateFlowModal onClose={() => setShowCreate(false)} onCreate={createFlow} />}
      {confirmDelete && (
        <ConfirmModal
          open
          danger
          title="Delete flow?"
          body="This removes the flow and all its written emails. This can't be undone."
          confirmLabel="Delete"
          onConfirm={() => deleteFlow(confirmDelete)}
          onClose={() => setConfirmDelete(null)}
        />
      )}
    </div>
  );
}

// ---- Create-flow modal -----------------------------------------------------
function CreateFlowModal({
  onClose,
  onCreate,
}: {
  onClose: () => void;
  onCreate: (args: { type: FlowType; name: string; goal?: string; klaviyo?: KlaviyoFlow | null }) => void;
}) {
  const [type, setType] = useState<FlowType>("welcome");
  const [name, setName] = useState(FLOW_TYPE_META.welcome.label + " flow");
  const [nameEdited, setNameEdited] = useState(false);
  const [goal, setGoal] = useState("");
  const [klaviyoFlows, setKlaviyoFlows] = useState<KlaviyoFlow[]>([]);
  const [klaviyoId, setKlaviyoId] = useState("");

  // Load real Klaviyo flows for the optional link (best-effort; empty on error).
  useEffect(() => {
    let live = true;
    fetch("/api/klaviyo/flows-list")
      .then((r) => (r.ok ? r.json() : { flows: [] }))
      .then((d) => { if (live) setKlaviyoFlows(d.flows ?? []); })
      .catch(() => {});
    return () => { live = false; };
  }, []);

  // Default the name from the type until the user edits it.
  const pickType = (t: FlowType) => {
    setType(t);
    if (!nameEdited) setName(`${FLOW_TYPE_META[t].label} flow`);
  };

  const create = () => {
    const klaviyo = klaviyoFlows.find((f) => f.id === klaviyoId) ?? null;
    onCreate({ type, name, goal, klaviyo });
  };

  return (
    <Modal
      open
      onClose={onClose}
      title="New flow"
      footer={
        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button variant="primary" onClick={create}>Create flow</Button>
        </div>
      }
    >
      <div className="space-y-4">
        <div>
          <label className="t-label block mb-1.5">Flow type</label>
          <div className="grid grid-cols-2 gap-2">
            {FLOW_TYPES.map((t) => (
              <button
                key={t}
                onClick={() => pickType(t)}
                className={`text-left p-2.5 rounded-md border transition-colors ${
                  type === t ? "border-accent bg-accent-50" : "border-line hover:border-line-strong bg-surface"
                }`}
              >
                <div className="text-sm font-medium text-ink">{FLOW_TYPE_META[t].label}</div>
                <div className="text-[11px] text-ink-muted mt-0.5 leading-snug">{FLOW_TYPE_META[t].hint}</div>
              </button>
            ))}
          </div>
          <p className="text-xs text-ink-muted mt-2">
            Scaffolds {FLOW_PLAYBOOKS[type].emails.length} email{FLOW_PLAYBOOKS[type].emails.length === 1 ? "" : "s"} you can write one at a time.
          </p>
        </div>

        <div>
          <label className="t-label block mb-1.5">Name</label>
          <input
            value={name}
            onChange={(e) => { setName(e.target.value); setNameEdited(true); }}
            className="w-full text-sm border border-line rounded-md px-3 py-2 bg-surface focus:outline-none focus:border-accent transition-colors"
          />
        </div>

        <div>
          <label className="t-label block mb-1.5">Goal <span className="font-normal text-ink-muted">(optional)</span></label>
          <textarea
            value={goal}
            onChange={(e) => setGoal(e.target.value)}
            rows={2}
            placeholder="What should this flow accomplish? Steers every email."
            className="w-full text-sm border border-line rounded-md px-3 py-2 bg-surface focus:outline-none focus:border-accent transition-colors resize-y"
          />
        </div>

        {klaviyoFlows.length > 0 && (
          <div>
            <label className="t-label block mb-1.5">Link to a real Klaviyo flow <span className="font-normal text-ink-muted">(optional)</span></label>
            <select
              value={klaviyoId}
              onChange={(e) => setKlaviyoId(e.target.value)}
              className="w-full text-sm border border-line rounded-md px-3 py-2 bg-surface focus:outline-none focus:border-accent transition-colors"
            >
              <option value="">— none —</option>
              {klaviyoFlows.map((f) => <option key={f.id} value={f.id}>{f.name}</option>)}
            </select>
          </div>
        )}
      </div>
    </Modal>
  );
}
