"use client";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type {
  Flow, FlowEmail, FlowNode, FlowNodeKind, FlowType, GeneratedCampaign, GeneratedSection,
  Conceit, CampaignMeta,
} from "@/lib/schemas";
import { FLOW_TYPES, FLOW_TYPE_META, DEFAULT_TONE_DIAL } from "@/lib/schemas";
import * as canvasSections from "@/lib/campaign-sections";
import type { CanvasSections } from "@/lib/campaign-sections";
import { FLOW_PLAYBOOKS, scaffoldSections, DEFAULT_EMAIL_STRUCTURE } from "@/lib/flow-playbooks";
import { expandedBriefForFlowEmail, productsFromStructure } from "@/lib/flow-brief";
import { flowEmailId } from "@/lib/flow-email-id";
import * as fg from "@/lib/flow-graph";
import type { FlowGraph } from "@/lib/flow-graph";
import { tidyLayout } from "@/lib/flow-layout";
import { buildCopyExport, buildMultiCopyExport, writeToClipboard, type CopyExportOpts } from "@/lib/copy-export";
import type { PlannerRow } from "@/lib/planner-types";
import { EVERGREEN_OFFER } from "@/lib/planner-types";
import { nanoid } from "@/lib/nanoid";
import { normalizeSectionElements } from "@/lib/normalize-section";
import { scrubElements, scrubMeta } from "@/lib/hard-rules-client";
import { unverifiedReviews, describeUnverified, migrateLegacyProvenance } from "@/lib/reviews/provenance";
import CampaignCanvas from "@/components/CampaignCanvas";
import FlowCanvas, { EmptyCanvasPrompt, type FlowCanvasActions } from "./FlowCanvas";
import Button from "@/components/ui/Button";
import EmptyState from "@/components/ui/EmptyState";
import Modal from "@/components/ui/Modal";
import { ConfirmModal } from "@/components/ui/Modal";
import AutosaveStatus, { type AutosaveState } from "@/components/ui/AutosaveStatus";
import { toast } from "@/components/ui/Toast";

// The Flows builder. A dedicated home for authoring TRIGGERED flow copy, distinct
// from the campaign copy-builder: pick/create a flow, pick a node on the canvas,
// give the email its job and highlights, generate via the flow BRAIN
// (/api/flows/generate), and edit in the SAME canvas campaigns use.
//
// Structure is a GRAPH now (docs/FLOW_CANVAS_REBUILD_SPEC.md): nodes and edges,
// with real Yes/No branches, instead of an integer `position` per email and two
// label strings per "split" that never pointed anywhere. Every structural rule
// lives in lib/flow-graph.ts; this file renders and dispatches.
//
// Persistence is ONE model, not two: everything autosaves on a 1.5s debounce
// (spec §2.2). Half the fields used to save themselves and half needed a Save
// button the user had to notice — and the three that needed it were the job, the
// delay and the highlights, i.e. the whole of the work on a custom flow.

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
const AUTOSAVE_MS = 1500;

function todayYMD(): string {
  return new Date().toISOString().slice(0, 10);
}
function slugify(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 40) || "flow";
}

// Header context for an exported flow email. A campaign's export doesn't need
// this; a flow email's is useless without it — pasted into a doc it has to say
// which flow it belongs to and where in the sequence it sits.
function exportOptsFor(flow: Flow, email: FlowEmail, total: number): CopyExportOpts {
  return {
    title: flow.name,
    subtitle: {
      label: `Email ${email.position} of ${total}`,
      value: FLOW_TYPE_META[flow.type]?.label ?? flow.type,
      ...(email.delay?.trim() ? { note: email.delay.trim() } : {}),
    },
  };
}

// A compact one-line summary of a written email, fed to the brain as sibling
// context so the sequence reads as an arc (not repeated sends).
function summarizeEmail(email: Pick<FlowEmail, "campaign">): string | undefined {
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

/** A brand-new email node's payload. */
function blankEmail(): NonNullable<FlowNode["email"]> {
  return {
    id: nanoid(),
    job: "",
    delay: "Later",
    section_structure: scaffoldSections(DEFAULT_EMAIL_STRUCTURE, nanoid),
    status: "empty",
  };
}

/** The default payload for each node kind the picker can insert. */
function nodePayload(kind: FlowNodeKind, splitLabel?: string): Partial<FlowNode> {
  switch (kind) {
    case "email": return { email: blankEmail() };
    case "delay": return { delay: { label: "Wait 2 days" } };
    case "exit": return { exit: { label: "Exit the flow" } };
    case "split": return { split: { label: splitLabel ?? "" } };
    default: return {};
  }
}

export default function FlowsPage() {
  const [flows, setFlows] = useState<FlowListItem[]>([]);
  const [flow, setFlow] = useState<Flow | null>(null);
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  const [generatingNodeId, setGeneratingNodeId] = useState<string | null>(null);
  const [showCreate, setShowCreate] = useState(false);
  const [confirmDeleteFlow, setConfirmDeleteFlow] = useState<string | null>(null);
  const [confirmDeleteNode, setConfirmDeleteNode] = useState<{ id: string; emailCount: number } | null>(null);
  // Planner rows, for the link picker and to name the row a linked email points at.
  const [plannerRows, setPlannerRows] = useState<PlannerRow[]>([]);
  const [showLinkPicker, setShowLinkPicker] = useState(false);
  const [linkBusy, setLinkBusy] = useState(false);
  const [autosave, setAutosave] = useState<AutosaveState>("idle");

  const graph: FlowGraph = useMemo(
    () => ({ nodes: flow?.nodes ?? [], edges: flow?.edges ?? [] }),
    [flow?.nodes, flow?.edges],
  );

  const refreshList = useCallback(async () => {
    try {
      const res = await fetch("/api/flows");
      const data = await res.json();
      setFlows(data.flows ?? []);
    } catch {
      /* list stays as-is */
    }
  }, []);

  const refreshPlannerRows = useCallback(async () => {
    try {
      const res = await fetch("/api/planner");
      const data = await res.json();
      setPlannerRows((data.rows ?? []) as PlannerRow[]);
    } catch {
      /* the picker just won't have suggestions */
    }
  }, []);

  useEffect(() => { void refreshList(); }, [refreshList]);
  useEffect(() => { void refreshPlannerRows(); }, [refreshPlannerRows]);

  // ---- autosave (spec §2.2) -----------------------------------------------
  // Mirrors the Copy Builder's library autosave: a debounce effect marks the
  // record dirty and schedules a save; flush runs it single-flight with a trailing
  // follow-up; exit paths flush synchronously via sendBeacon.
  const flowRef = useRef<Flow | null>(null);
  flowRef.current = flow;
  const dirtyRef = useRef(false);
  const savingRef = useRef(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const fadeRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const baselineRef = useRef<string | null>(null);   // flow id we've baselined
  const failCountRef = useRef(0);
  const flushRef = useRef<() => void>(() => {});
  const beaconRef = useRef<() => void>(() => {});

  const bodyForSave = (f: Flow) => JSON.stringify({ ...f, updated_at: new Date().toISOString() });

  flushRef.current = () => {
    const f = flowRef.current;
    if (!f) return;
    if (savingRef.current) { dirtyRef.current = true; return; }
    if (timerRef.current) { clearTimeout(timerRef.current); timerRef.current = null; }
    if (fadeRef.current) { clearTimeout(fadeRef.current); fadeRef.current = null; }
    dirtyRef.current = false;
    savingRef.current = true;
    setAutosave("saving");
    fetch("/api/flows", { method: "POST", headers: { "Content-Type": "application/json" }, body: bodyForSave(f) })
      .then((res) => { if (!res.ok) throw new Error(`HTTP ${res.status}`); })
      .then(() => {
        savingRef.current = false;
        failCountRef.current = 0;
        if (dirtyRef.current) {
          flushRef.current();            // trailing: newer edits arrived mid-save
        } else {
          setAutosave("saved");
          fadeRef.current = setTimeout(() => setAutosave("check"), 2000);
          void refreshList();            // keep the sidebar's counts in step
        }
      })
      .catch(() => {
        savingRef.current = false;
        dirtyRef.current = true;         // stay dirty so the next edit / Retry re-attempts
        failCountRef.current += 1;
        setAutosave("error");
        if (failCountRef.current === 2) toast.error("Autosave failed — your changes are still here. Hit Retry.");
      });
  };

  // Best-effort flush for tab close / route change, so the last edit isn't lost.
  beaconRef.current = () => {
    const f = flowRef.current;
    if (!f) return;
    if (!dirtyRef.current && !timerRef.current) return;
    const body = bodyForSave(f);
    try {
      if (navigator.sendBeacon("/api/flows", new Blob([body], { type: "application/json" }))) return;
    } catch { /* fall through to a keepalive fetch */ }
    fetch("/api/flows", { method: "POST", headers: { "Content-Type": "application/json" }, body, keepalive: true }).catch(() => {});
  };

  // The debounce loop. Gated while an email is generating: the stream writes state
  // dozens of times, and a save mid-stream persists a half-written email.
  useEffect(() => {
    if (!flow || generatingNodeId) return;
    if (baselineRef.current !== flow.id) {
      baselineRef.current = flow.id;   // freshly loaded — baseline, don't save
      return;
    }
    dirtyRef.current = true;
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => { timerRef.current = null; flushRef.current(); }, AUTOSAVE_MS);
    return () => { if (timerRef.current) { clearTimeout(timerRef.current); timerRef.current = null; } };
  }, [flow, generatingNodeId]);

  useEffect(() => {
    const onExit = () => beaconRef.current();
    window.addEventListener("pagehide", onExit);
    window.addEventListener("beforeunload", onExit);
    return () => {
      window.removeEventListener("pagehide", onExit);
      window.removeEventListener("beforeunload", onExit);
      beaconRef.current();   // unmount (navigating away from /flows)
    };
  }, []);

  /** Persist NOW, bypassing the debounce. For the paths that must not wait: a
   * freshly created flow, and the moment a generation finishes. */
  const persistNow = useCallback(async (next: Flow) => {
    setAutosave("saving");
    try {
      const res = await fetch("/api/flows", {
        method: "POST", headers: { "Content-Type": "application/json" }, body: bodyForSave(next),
      });
      if (!res.ok) throw new Error("save failed");
      dirtyRef.current = false;
      setAutosave("saved");
      fadeRef.current = setTimeout(() => setAutosave("check"), 2000);
      await refreshList();
    } catch {
      setAutosave("error");
      toast.error("Save failed — your edits are still here, try again.");
    }
  }, [refreshList]);

  // ---- loading ------------------------------------------------------------
  const selectFlow = useCallback(async (id: string) => {
    beaconRef.current();   // don't lose a pending edit on the way out of this flow
    try {
      const res = await fetch(`/api/flows?id=${encodeURIComponent(id)}`);
      if (!res.ok) throw new Error("Not found");
      const f: Flow = (await res.json()).flow;
      // The read boundary migrates a pre-graph flow, so `nodes` is always here;
      // ensureGraph covers a record that somehow arrives unmigrated.
      const g = fg.ensureGraph(f, nanoid, FLOW_PLAYBOOKS[f.type]?.trigger);
      // Reviews written before provenance existed carry no record, and the gate on
      // Mark final would read them as unverified — retroactively blocking every
      // flow email that already has a real review. They migrate to "curated",
      // exactly as a loaded library campaign does
      // (docs/REVIEWS_MODULE_SPEC.md §6).
      const migrated: FlowGraph = {
        ...g,
        nodes: g.nodes.map((n) => (n.kind === "email" && n.email?.campaign
          ? { ...n, email: { ...n.email, campaign: migrateLegacyProvenance(n.email.campaign) } }
          : n)),
      };
      setFlow(fg.withGraph(f, migrated));
      setSelectedNodeId(fg.emailNodesInOrder(migrated)[0]?.id ?? null);
      setAutosave("idle");
    } catch {
      toast.error("Could not load that flow");
    }
  }, []);

  // ---- structural edits: every one goes through lib/flow-graph -------------
  const graphOf = (f: Flow): FlowGraph => ({ nodes: f.nodes ?? [], edges: f.edges ?? [] });

  const onMoveNode = useCallback((id: string, x: number, y: number) => {
    setFlow((prev) => (prev ? fg.withGraph(prev, fg.moveNode(graphOf(prev), id, x, y)) : prev));
  }, []);

  const onInsert = useCallback((parentId: string, kind: FlowNodeKind, branch?: "yes" | "no", splitLabel?: string) => {
    setFlow((prev) => {
      if (!prev) return prev;
      // A split arrives with both branches wired to exits, so it is never left in
      // an invalid one-outbound state.
      const result = kind === "split"
        ? fg.insertSplit(graphOf(prev), parentId, nanoid, { label: splitLabel ?? "" }, branch)
        : fg.insertAfter(graphOf(prev), parentId, kind, nanoid, { branch, node: nodePayload(kind, splitLabel) });
      if (kind === "email") setSelectedNodeId(result.nodeId);
      return fg.withGraph(prev, result.graph);
    });
  }, []);

  const onConnectNodes = useCallback((from: string, to: string, branch?: "yes" | "no") => {
    setFlow((prev) => {
      if (!prev) return prev;
      const res = fg.connect(graphOf(prev), from, to, nanoid, branch);
      if (!res.ok) {
        // Rejected connections are explained, never silently dropped (spec §3).
        toast.error({
          cycle: "That would loop the flow back on itself.",
          missing: "Nothing can lead into the trigger.",
          occupied: "That step already leads somewhere.",
          split_needs_branch: "Drag from the Yes or the No handle on a branch.",
        }[res.reason]);
        return prev;
      }
      return fg.withGraph(prev, res.graph);
    });
  }, []);

  const onReconnectEdge = useCallback((edgeId: string, to: string) => {
    setFlow((prev) => {
      if (!prev) return prev;
      const res = fg.reconnect(graphOf(prev), edgeId, to);
      if (!res.ok) {
        toast.error(res.reason === "cycle" ? "That would loop the flow back on itself." : "That connection isn't allowed.");
        return prev;
      }
      return fg.withGraph(prev, res.graph);
    });
  }, []);

  // Release any planner rows pointing at these emails. Deleting the copy without
  // this leaves the row linked to a flow email that no longer exists — and the
  // planner's stale-link healing deliberately does not touch flow links (it can't
  // tell a valid one from a dead one), so nothing else would ever clean it up.
  const releasePlannerRows = useCallback(async (rowIds: string[]) => {
    if (!rowIds.length) return;
    await Promise.all(rowIds.map((rowId) =>
      fetch(`/api/planner/link?row_id=${encodeURIComponent(rowId)}`, { method: "DELETE" }).catch(() => {})));
    await refreshPlannerRows();
  }, [refreshPlannerRows]);

  /** Actually remove a node (and, for a split, its subtree). The confirm happens
   * upstream in requestDeleteNode so the user is told how many emails go. */
  const doDeleteNode = useCallback((id: string) => {
    setConfirmDeleteNode(null);
    setFlow((prev) => {
      if (!prev) return prev;
      const before = graphOf(prev);
      const { graph: after, removed } = fg.deleteNode(before, id);
      if (!removed.length) return prev;
      void releasePlannerRows(
        removed.map((r) => fg.nodeById(before, r)?.email?.planner_row_id).filter((r): r is string => !!r),
      );
      const gone = new Set(removed);
      setSelectedNodeId((cur) => (cur && !gone.has(cur) ? cur : fg.emailNodesInOrder(after)[0]?.id ?? null));
      return fg.withGraph(prev, after);
    });
  }, [releasePlannerRows]);

  const requestDeleteNode = useCallback((id: string) => {
    // Through the ref, not `graph`: this handler goes into the canvas's actions
    // object, and a dependency on the graph would change that object's identity on
    // every keystroke, re-rendering every node
    // (docs/FLOW_CANVAS_PERFORMANCE_SPEC.md §2.5).
    const current = flowRef.current;
    if (!current) return;
    const impact = fg.deletionImpact(graphOf(current), id);
    if (!impact.removed.length) return;
    // Deleting a split takes its whole downstream subtree, so it has to say how
    // many emails that is BEFORE it happens (spec §4.4).
    if (impact.removed.length > 1 || impact.emailCount > 0) {
      setConfirmDeleteNode({ id, emailCount: impact.emailCount });
      return;
    }
    doDeleteNode(id);
  }, [doDeleteNode]);

  const onTidy = useCallback(() => {
    setFlow((prev) => (prev ? fg.withGraph(prev, tidyLayout(graphOf(prev))) : prev));
    toast.success("Canvas tidied");
  }, []);

  const patchNode = useCallback((id: string, patch: Partial<FlowNode>) => {
    setFlow((prev) => (prev ? fg.withGraph(prev, fg.updateNode(graphOf(prev), id, patch)) : prev));
  }, []);

  const onEditTrigger = useCallback((id: string, label: string) => {
    // Mirrored onto `flow.trigger` as well: that is what the generation payload
    // reads, and a trigger living only on the node would stop reaching the brain.
    setFlow((prev) => {
      if (!prev) return prev;
      const g = fg.updateNode(graphOf(prev), id, { trigger: { label } });
      return { ...fg.withGraph(prev, g), trigger: label.trim() || undefined };
    });
  }, []);

  const onEditSplit = useCallback((id: string, fields: { label?: string; yes_label?: string; no_label?: string }) => {
    setFlow((prev) => (prev ? fg.withGraph(prev, fg.updateSplitFields(graphOf(prev), id, fields)) : prev));
  }, []);

  const onEditDelay = useCallback((id: string, label: string) => patchNode(id, { delay: { label } }), [patchNode]);
  const onEditExit = useCallback((id: string, label: string) => patchNode(id, { exit: { label } }), [patchNode]);

  // ---- the selected email -------------------------------------------------
  const selectedNode = fg.nodeById(graph, selectedNodeId);
  const emailOrder = useMemo(() => fg.emailNodesInOrder(graph), [graph]);
  const totalEmails = emailOrder.length;

  /** The selected email as a FlowEmail — the node payload plus the position the
   * graph gives it, so everything downstream (export, planner, conceit) reads
   * exactly what it read before the rebuild. */
  const selectedEmail: FlowEmail | null = useMemo(() => {
    if (selectedNode?.kind !== "email" || !selectedNode.email) return null;
    return { ...selectedNode.email, id: selectedNode.id, position: fg.positionOf(graph, selectedNode.id) };
  }, [selectedNode, graph]);

  const updateEmail = useCallback((nodeId: string, patch: Partial<FlowEmail>) => {
    setFlow((prev) => {
      if (!prev) return prev;
      const { position: _position, ...rest } = patch;   // position is derived, never stored
      return fg.withGraph(prev, fg.updateEmailNode(graphOf(prev), nodeId, rest));
    });
  }, []);

  // ---- create / delete a flow --------------------------------------------
  const createFlow = useCallback(async (args: { type: FlowType; name: string; goal?: string; klaviyo?: KlaviyoFlow | null }) => {
    const now = new Date().toISOString();
    const pb = FLOW_PLAYBOOKS[args.type];
    // Scaffold as the legacy linear shape and let the migration build the graph —
    // one code path for "turn a sequence into a graph", exercised on every create.
    const emails: FlowEmail[] = pb.emails.map((ej) => ({
      id: nanoid(),
      position: ej.position,
      job: ej.job,
      delay: ej.delay,
      section_structure: scaffoldSections(ej.default_structure, nanoid),
      status: "empty" as const,
    }));
    const base: Flow = {
      id: `${todayYMD()}-${slugify(args.name)}-${nanoid().slice(0, 6)}`,
      name: args.name.trim() || FLOW_TYPE_META[args.type].label,
      type: args.type,
      channel: "email",
      trigger: pb.trigger,
      goal: args.goal?.trim() || undefined,
      klaviyo_flow_id: args.klaviyo?.id,
      klaviyo_flow_name: args.klaviyo?.name,
      emails,
      splits: [],
      created_at: now,
      updated_at: now,
    };
    const f = fg.withGraph(base, fg.migrateLinearFlowToGraph(base, nanoid, pb.trigger));
    setShowCreate(false);
    setFlow(f);
    baselineRef.current = f.id;      // brand new: persisted explicitly below
    setSelectedNodeId(fg.emailNodesInOrder(graphOf(f))[0]?.id ?? null);
    await persistNow(f);
    toast.success(`Created "${f.name}" — ${emails.length} email${emails.length === 1 ? "" : "s"} scaffolded`);
  }, [persistNow]);

  const deleteFlow = useCallback(async (id: string) => {
    setConfirmDeleteFlow(null);
    // Read the flow first (it may not be the one on screen) so its emails' planner
    // rows can be released before the copy goes away.
    let doomed: Flow | null = flow?.id === id ? flow : null;
    if (!doomed) {
      try {
        const res = await fetch(`/api/flows?id=${encodeURIComponent(id)}`);
        if (res.ok) doomed = (await res.json()).flow as Flow;
      } catch { /* best effort — the delete still proceeds */ }
    }
    if (doomed) {
      await releasePlannerRows([
        ...(doomed.nodes ?? []).map((n) => n.email?.planner_row_id),
        ...doomed.emails.map((e) => e.planner_row_id),
      ].filter((r): r is string => !!r));
    }
    await fetch(`/api/flows?id=${encodeURIComponent(id)}`, { method: "DELETE" });
    if (flow?.id === id) {
      // Cancel any pending autosave — it would re-create the flow we just deleted.
      dirtyRef.current = false;
      if (timerRef.current) { clearTimeout(timerRef.current); timerRef.current = null; }
      setFlow(null);
      setSelectedNodeId(null);
      setAutosave("idle");
    }
    await refreshList();
    toast.success("Flow deleted");
  }, [flow, refreshList, releasePlannerRows]);

  // ---- write one email (stream from the flow brain) ------------------------
  const writeEmail = useCallback(async (nodeId: string) => {
    if (!flow) return;
    const g = graphOf(flow);
    const node = fg.nodeById(g, nodeId);
    if (node?.kind !== "email" || !node.email) return;
    const email = node.email;
    setGeneratingNodeId(nodeId);

    // Siblings come from THIS email's path, not from every email in the flow: on a
    // branched graph the latter hands an email on the Yes branch the context of the
    // No branch — messages the reader demonstrably never received (spec §5).
    const siblings = fg.pathSiblings(g, nodeId).map(({ position, node: n }) => ({
      position,
      job: n.email?.job ?? "",
      summary: summarizeEmail({ campaign: n.email?.campaign }),
    }));

    const context = {
      flow_type: flow.type,
      flow_name: flow.name,
      channel: flow.channel,
      trigger: flow.trigger ?? FLOW_PLAYBOOKS[flow.type].trigger,
      goal: flow.goal,
      position: fg.positionOf(g, nodeId),
      total_emails: fg.emailNodesInOrder(g).length,
      job: email.job,
      delay: email.delay,
      highlights: email.highlights,
      path_context: fg.pathContext(g, nodeId),
      siblings,
    };

    let meta = { ...EMPTY_META };
    let sections: GeneratedSection[] = [];
    // Seed the canvas so it renders live as sections stream in.
    updateEmail(nodeId, { campaign: { meta, sections: [] } });

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
              toast.info(`No eligible review found for ${parsed.review_gaps.map((gap: { name: string }) => gap.name).join(", ")} — that Review field stays empty.`);
            } else if (parsed.meta) {
              meta = scrubMeta(parsed.meta);
              updateEmail(nodeId, { campaign: { meta, sections: [...sections] } });
            } else if (parsed.type) {
              const { elements, ...slates } = normalizeSectionElements(scrubElements(parsed.elements));
              const newSection: GeneratedSection = {
                id: nanoid(), type: parsed.type, elements, ...slates,
                // Carried through from the server's review strip. Without it the
                // canvas can't show a review's origin and the hard-rules
                // provenance gate has nothing to check, so a real review would
                // read as unverified (docs/REVIEWS_MODULE_SPEC.md §5).
                ...(parsed.review_provenance ? { review_provenance: parsed.review_provenance } : {}),
              };
              sections = [...sections, newSection];
              updateEmail(nodeId, { campaign: { meta, sections } });
            }
          } catch {
            /* ignore partial / unparseable lines */
          }
        }
      }
      // Persist the freshly written email as a draft. Explicit rather than left to
      // the debounce, because autosave is suppressed while generating.
      const written: GeneratedCampaign = { meta, sections };
      setFlow((prev) => {
        if (!prev) return prev;
        const next = fg.withGraph(prev, fg.updateEmailNode(graphOf(prev), nodeId, { campaign: written, status: "draft" }));
        void persistNow(next);
        return next;
      });
      toast.success(`Email written — ${sections.length} section${sections.length === 1 ? "" : "s"}`);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Generation failed");
      // Roll the seeded-but-empty campaign back if nothing streamed.
      if (!sections.length) updateEmail(nodeId, { campaign: undefined });
    } finally {
      setGeneratingNodeId(null);
    }
  }, [flow, updateEmail, persistNow]);

  /**
   * Marking a flow email final is its Save Final, so it gets the same provenance
   * gate (docs/REVIEWS_MODULE_SPEC.md §5.2 point 3). Everything else in the
   * hard-rules report is advisory craft; a review with no source on record is a
   * factual claim about a customer who may not exist, and shipping that is worse
   * than being interrupted. Checked from local state, so it is instant and can't
   * be skipped by a failed request.
   */
  const markFinal = useCallback((nodeId: string, email: FlowEmail) => {
    const goingFinal = email.status !== "final";
    if (goingFinal) {
      const unverified = unverifiedReviews(email.campaign);
      if (unverified.length) {
        toast.error(
          `Can't mark final: ${unverified.length} review${unverified.length === 1 ? "" : "s"} ${unverified.length === 1 ? "has" : "have"} no source on record (${describeUnverified(unverified)}). Fetch a real one on the canvas, paste one in, or clear the slot.`,
        );
        return;
      }
    }
    updateEmail(nodeId, { status: goingFinal ? "final" : "draft" });
  }, [updateEmail]);

  // ---- the email's own copy canvas ---------------------------------------
  const onCanvasChange = useCallback((c: GeneratedCampaign) => {
    if (selectedNodeId) updateEmail(selectedNodeId, { campaign: c });
  }, [selectedNodeId, updateEmail]);

  // Flow canvases render the SAME CampaignCanvas as campaigns, so they use the
  // same pure section helpers — which is what keeps a flow email's specs attached
  // to their own sections instead of shifting by one on every insert.
  const canvasState = useMemo(
    () => (selectedEmail?.campaign
      ? { campaign: selectedEmail.campaign, sectionStructure: selectedEmail.section_structure ?? [] }
      : null),
    [selectedEmail],
  );
  const commitSections = useCallback((next: CanvasSections) => {
    if (selectedNodeId) updateEmail(selectedNodeId, { campaign: next.campaign, section_structure: next.sectionStructure });
  }, [selectedNodeId, updateEmail]);

  // ---- getting the copy out ------------------------------------------------
  // The build lives in lib/copy-export.ts, shared with the Copy Builder's Copy
  // button — one implementation, so the two can't drift.
  const copyEmail = useCallback(async (email: FlowEmail) => {
    if (!flow || !email.campaign) return;
    const flavour = await writeToClipboard(
      buildCopyExport(email.campaign, email.section_structure ?? [], exportOptsFor(flow, email, totalEmails)),
    );
    toast.success(flavour === "rich" ? "Copied for Google Docs" : "Copied to clipboard");
  }, [flow, totalEmails]);

  /** Written emails only, in graph order. An unwritten email is skipped rather
   * than exported as a heading with nothing under it. */
  const writtenEmails = useMemo(
    () => emailOrder
      .map((n, i) => ({ ...n.email!, id: n.id, position: i + 1 } as FlowEmail))
      .filter((e) => e.campaign && e.campaign.sections.length > 0),
    [emailOrder],
  );

  // The whole sequence in order — what actually gets pasted into a brief or a
  // review doc, and the thing that makes a flow legible to someone not in the app.
  const copyFlow = useCallback(async () => {
    if (!flow) return;
    if (!writtenEmails.length) {
      toast.info("Nothing to copy yet — write an email first.");
      return;
    }
    const flavour = await writeToClipboard(buildMultiCopyExport(
      writtenEmails.map((email) => ({
        campaign: email.campaign!,
        sectionStructure: email.section_structure ?? [],
        opts: exportOptsFor(flow, email, totalEmails),
      })),
    ));
    const skipped = totalEmails - writtenEmails.length;
    toast.success(
      `Copied ${writtenEmails.length} email${writtenEmails.length === 1 ? "" : "s"}`
      + (skipped > 0 ? ` — ${skipped} not written yet, skipped` : "")
      + (flavour === "rich" ? " (formatted for Google Docs)" : ""),
    );
  }, [flow, writtenEmails, totalEmails]);

  // ---- planner link --------------------------------------------------------
  // A flow email is addressed by the composite id "<flowId>::<emailId>" — it is
  // nested inside a Flow, so it has no top-level store id of its own.
  const selectedCopyId = flow && selectedEmail ? flowEmailId(flow.id, selectedEmail.id) : null;
  const linkedRowId = selectedEmail?.planner_row_id;
  const linkedRow = linkedRowId ? plannerRows.find((r) => r.id === linkedRowId) ?? null : null;

  /** Attach the selected email to a row. `reassign` is sent only after the writer
   * has agreed to take a row another copy owns — without it the API answers 409,
   * the same contract the Copy Builder honours. */
  const linkToRow = useCallback(async (rowId: string, reassign = false): Promise<boolean> => {
    if (!selectedEmail || !selectedCopyId || !selectedNodeId) return false;
    setLinkBusy(true);
    try {
      const res = await fetch("/api/planner/link", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          row_id: rowId,
          copy_campaign_id: selectedCopyId,
          copy_status: selectedEmail.status === "final" ? "final" : "draft",
          reassign,
        }),
      });
      if (res.status === 409) {
        const data = await res.json().catch(() => ({}));
        toast.error(`That row is already linked to ${data?.conflict?.owner_name ?? "another copy"}. Unlink it there first.`);
        return false;
      }
      if (!res.ok) throw new Error("link failed");
      // Mirror the server-side back-reference into local state. Without this the
      // next save would post the flow WITHOUT planner_row_id and wipe the link.
      updateEmail(selectedNodeId, { planner_row_id: rowId });
      await refreshPlannerRows();
      toast.success("Linked to planner ✓");
      return true;
    } catch {
      toast.error("Could not link this email to the planner.");
      return false;
    } finally {
      setLinkBusy(false);
    }
  }, [selectedEmail, selectedCopyId, selectedNodeId, updateEmail, refreshPlannerRows]);

  /** Create a planner row FOR this email and link it. A flow email gets its own
   * row rather than borrowing a campaign's: the row is marked `flow_email`, which
   * is what keeps it out of metrics sync and Copy Performance. */
  const createRowAndLink = useCallback(async (name: string, ymd: string): Promise<boolean> => {
    if (!flow) return false;
    setLinkBusy(true);
    try {
      const res = await fetch("/api/planner", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name,
          channel: "email",
          row_kind: "flow_email",
          offer_type: "evergreen",
          offer: EVERGREEN_OFFER,
          planned_send_at: new Date(`${ymd}T09:00:00`).toISOString(),
          status: "writing_brief",
          notes: `Flow email — ${flow.name}. Triggered and evergreen: no scheduled send, no metrics.`,
        }),
      });
      if (!res.ok) throw new Error("create failed");
      const row = (await res.json()).row as PlannerRow;
      setPlannerRows((prev) => [...prev, row]);
      return await linkToRow(row.id);
    } catch {
      toast.error("Could not create a planner row for this email.");
      return false;
    } finally {
      setLinkBusy(false);
    }
  }, [flow, linkToRow]);

  /** Detach — visible and reversible, per the planner-autolink fix: a link is an
   * explicit act, never inherited and never silent. Clears BOTH sides. */
  const unlinkRow = useCallback(async () => {
    if (!selectedNodeId || !linkedRowId) return;
    setLinkBusy(true);
    try {
      const res = await fetch(`/api/planner/link?row_id=${encodeURIComponent(linkedRowId)}`, { method: "DELETE" });
      if (!res.ok) throw new Error("unlink failed");
      updateEmail(selectedNodeId, { planner_row_id: undefined });
      await refreshPlannerRows();
      toast.success("Unlinked from the planner");
    } catch {
      toast.error("Could not unlink this email.");
    } finally {
      setLinkBusy(false);
    }
  }, [selectedNodeId, linkedRowId, updateEmail, refreshPlannerRows]);

  /** The design handoff: the same deep link + Slack-ready message the planner
   * builds. The link resolves through /api/planner/copy, so it opens the copy
   * whether or not this email is on a planner row; when it IS, the row also moves
   * to "ready for design", exactly as the planner's own handoff does. */
  const copyHandoff = useCallback(async () => {
    if (!flow || !selectedEmail || !selectedCopyId) return;
    setLinkBusy(true);
    try {
      const as = selectedEmail.status === "final" ? "final" : "draft";
      const link = `${window.location.origin}/planner?copy=${encodeURIComponent(selectedCopyId)}&as=${as}`;
      if (linkedRow && linkedRow.status !== "ready_for_design") {
        await fetch("/api/planner", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ id: linkedRow.id, name: linkedRow.name, channel: linkedRow.channel, status: "ready_for_design" }),
        });
        await refreshPlannerRows();
      }
      const label = FLOW_TYPE_META[flow.type]?.label ?? flow.type;
      // Which branch this email sits on — a designer building "email 3" needs to
      // know it is the No branch's third, not the flow's third.
      const branchNote = selectedNodeId ? fg.pathContext(graph, selectedNodeId).split("\n").pop() : "";
      const message = [
        "Hi there 👋",
        "",
        `This flow email, "${flow.name} — Email ${selectedEmail.position} of ${totalEmails}", is ready for design.`,
        `${label} flow${selectedEmail.delay?.trim() ? ` · fires ${selectedEmail.delay.trim()}` : ""} — triggered, no send date.`,
        ...(branchNote ? [branchNote] : []),
        "",
        `View the copy: ${link}`,
      ].join("\n");
      await navigator.clipboard.writeText(message);
      toast.success("Handoff copied — paste into Slack");
    } catch {
      toast.error("Couldn't copy the handoff message");
    } finally {
      setLinkBusy(false);
    }
  }, [flow, selectedEmail, selectedCopyId, selectedNodeId, graph, linkedRow, totalEmails, refreshPlannerRows]);

  // ---- the email pane's brief ---------------------------------------------
  const conceit: Conceit | null = useMemo(() => {
    if (!flow || !selectedEmail) return null;
    return {
      id: selectedEmail.id,
      name: `Email ${selectedEmail.position} of ${totalEmails} — ${FLOW_TYPE_META[flow.type].label}`,
      description: selectedEmail.highlights?.trim() || selectedEmail.job,
    };
  }, [flow, selectedEmail, totalEmails]);

  // The canvas gates EVERY AI assist on having both a brief and a conceit. This
  // page passed `expandedBrief={null}` from the day flows shipped, so element
  // rewrites, the 5-register section variations and subject/preview regeneration
  // were all dead here. A flow email has no compiled campaign brief, so we build
  // the flow-shaped one (pure, no network) instead of faking a campaign's.
  const expandedBrief = useMemo(
    () => (flow && selectedEmail ? expandedBriefForFlowEmail(flow, selectedEmail) : null),
    [flow, selectedEmail],
  );

  // A control is either working, or visibly disabled with a reason — never
  // missing without explanation.
  const assistsDisabledReason = selectedEmail?.job?.trim()
    ? undefined
    : "Set this email's job to enable rewrites.";

  // ONE object, memoised, with every handler `useCallback`'d on empty or stable
  // deps. The canvas puts this in a context that its node views consume, so a new
  // identity here re-renders every node on the canvas — which is why none of these
  // handlers may depend on `graph` (docs/FLOW_CANVAS_PERFORMANCE_SPEC.md §2.5).
  const canvasActions: FlowCanvasActions = useMemo(() => ({
    onSelectNode: setSelectedNodeId,
    onMoveNode,
    onInsert,
    onDelete: requestDeleteNode,
    onConnect: onConnectNodes,
    onReconnect: onReconnectEdge,
    onEditTrigger,
    onEditSplit,
    onEditDelay,
    onEditExit,
    onTidy,
  }), [onMoveNode, onInsert, requestDeleteNode, onConnectNodes, onReconnectEdge, onEditTrigger, onEditSplit, onEditDelay, onEditExit, onTidy]);

  const triggerId = fg.triggerNode(graph)?.id;

  return (
    <div className="rc-content-panel flex flex-1 min-h-0 overflow-hidden">
      {/* Flows list */}
      <aside className="w-64 shrink-0 border-r border-line bg-surface flex flex-col">
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
                onClick={(e) => { e.stopPropagation(); setConfirmDeleteFlow(item.id); }}
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

      {!flow ? (
        <main className="flex-1 flex items-center justify-center">
          <EmptyState
            title="Pick a flow, or create one"
            description="Flows are triggered, evergreen sequences — Welcome, Abandoned Cart, Post-Purchase. They get their own writing brain, tuned to relationship-building rather than one-off promos."
            action={<Button variant="secondary" onClick={() => setShowCreate(true)}>New flow</Button>}
          />
        </main>
      ) : (
        <div className="flex-1 flex min-w-0">
          {/* The graph canvas */}
          <section className="flex-1 min-w-0 flex flex-col">
            <header className="shrink-0 border-b border-line bg-surface px-4 py-3">
              <div className="flex items-start gap-3">
                <div className="min-w-0 flex-1">
                  <div className="t-label text-ink-secondary mb-0.5">{FLOW_TYPE_META[flow.type].label} flow</div>
                  {/* §2.1: the name and the goal were set once in the create modal
                      and then never writable again — worst for a custom flow, where
                      you name it before you have built anything. */}
                  <input
                    value={flow.name}
                    onChange={(e) => setFlow((prev) => (prev ? { ...prev, name: e.target.value } : prev))}
                    placeholder="Name this flow"
                    aria-label="Flow name"
                    className="w-full text-lg font-semibold text-ink bg-transparent border border-transparent hover:border-line focus:border-accent rounded px-1.5 -ml-1.5 py-0.5 focus:outline-none transition-colors"
                  />
                  <textarea
                    value={flow.goal ?? ""}
                    onChange={(e) => setFlow((prev) => (prev ? { ...prev, goal: e.target.value || undefined } : prev))}
                    placeholder="What should this flow accomplish? Steers every email."
                    rows={1}
                    aria-label="Flow goal"
                    className="mt-1 w-full text-xs text-ink-secondary bg-transparent border border-transparent hover:border-line focus:border-accent rounded px-1.5 -ml-1.5 py-0.5 focus:outline-none resize-y transition-colors placeholder:text-ink-muted"
                  />
                  {flow.klaviyo_flow_name && (
                    <div className="text-[11px] text-ink-muted mt-1">Linked to Klaviyo: {flow.klaviyo_flow_name}</div>
                  )}
                </div>
                <div className="flex items-center gap-2 shrink-0 pt-1">
                  <AutosaveStatus status={autosave} onRetry={() => flushRef.current()} />
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={copyFlow}
                    disabled={writtenEmails.length === 0}
                    title={writtenEmails.length === 0
                      ? "Write an email first"
                      : "Copy every written email in sequence, formatted for Google Docs"}
                  >
                    Copy flow
                  </Button>
                </div>
              </div>
            </header>

            <div className="flex-1 min-h-0 relative">
              <FlowCanvas
                graph={graph}
                flowType={flow.type}
                flowId={flow.id}
                selectedNodeId={selectedNodeId}
                generatingNodeId={generatingNodeId}
                actions={canvasActions}
              />
              {/* §4.3: a flow with only a trigger gets an affordance, not a blank grid. */}
              {graph.nodes.length <= 1 && triggerId && (
                <EmptyCanvasPrompt flowType={flow.type} onAdd={() => onInsert(triggerId, "email")} />
              )}
            </div>
          </section>

          {/* The email pane — unchanged in substance (spec §4.5) */}
          {selectedEmail && selectedNodeId && (
            <aside className="w-[44%] min-w-[400px] max-w-[720px] shrink-0 border-l border-line bg-canvas overflow-y-auto">
              <div className="px-5 py-5">
                <div className="bg-white border border-line rounded-lg p-5 mb-4">
                  <div className="flex items-center justify-between gap-4">
                    <div className="t-label">Email {selectedEmail.position} of {totalEmails}</div>
                    <div className="flex items-center gap-2">
                      <Button
                        size="sm"
                        variant="ghost"
                        disabled={!selectedEmail.campaign}
                        title={selectedEmail.campaign ? "Copy this email for Google Docs" : "Write this email first"}
                        onClick={() => copyEmail(selectedEmail)}
                      >
                        <svg aria-hidden className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><rect x="9" y="9" width="13" height="13" rx="2" /><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" /></svg>
                        Copy
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        loading={linkBusy}
                        disabled={!selectedEmail.campaign}
                        title={selectedEmail.campaign
                          ? "Mark the linked row ready for design and copy a Slack message with a link to this copy"
                          : "Write this email first"}
                        onClick={copyHandoff}
                      >
                        Handoff
                      </Button>
                      {/* §2.3: a custom flow scaffolds exactly one email, so the old
                          "a flow keeps at least one" guard made delete permanently a
                          no-op there. An empty flow is a legitimate state now — the
                          canvas has an affordance for it. */}
                      <Button size="sm" variant="ghost" title="Delete this email" onClick={() => requestDeleteNode(selectedNodeId)}>
                        Delete email
                      </Button>
                    </div>
                  </div>

                  <div className="mt-3 grid grid-cols-3 gap-3">
                    <div className="col-span-1">
                      <label className="t-label block mb-1">Delay</label>
                      <input
                        value={selectedEmail.delay ?? ""}
                        onChange={(e) => updateEmail(selectedNodeId, { delay: e.target.value })}
                        placeholder="e.g. 2 days later"
                        className="w-full text-sm border border-line rounded-md px-3 py-2 bg-surface focus:outline-none focus:border-accent transition-colors"
                      />
                    </div>
                    <div className="col-span-2">
                      <label className="t-label block mb-1">This email&apos;s job</label>
                      <input
                        value={selectedEmail.job}
                        onChange={(e) => updateEmail(selectedNodeId, { job: e.target.value })}
                        placeholder="What is this email for in the sequence?"
                        className="w-full text-sm border border-line rounded-md px-3 py-2 bg-surface focus:outline-none focus:border-accent transition-colors"
                      />
                    </div>
                  </div>

                  <div className="mt-3">
                    <label className="t-label block mb-1">What should this email emphasize? (X / Y / Z)</label>
                    <textarea
                      value={selectedEmail.highlights ?? ""}
                      onChange={(e) => updateEmail(selectedNodeId, { highlights: e.target.value })}
                      placeholder="e.g. lead with the 6-month warranty, name the Everyday Earbuds, mention free shipping"
                      rows={2}
                      className="w-full text-sm border border-line rounded-md px-3 py-2 bg-surface focus:outline-none focus:border-accent transition-colors resize-y"
                    />
                  </div>

                  <div className="mt-3 flex items-center gap-2">
                    <Button
                      variant="primary"
                      loading={generatingNodeId === selectedNodeId}
                      onClick={() => writeEmail(selectedNodeId)}
                    >
                      {selectedEmail.status === "empty" ? "Write this email" : "Rewrite"}
                    </Button>
                    {selectedEmail.status !== "empty" && (
                      <Button
                        variant="secondary"
                        onClick={() => markFinal(selectedNodeId, selectedEmail)}
                      >
                        {selectedEmail.status === "final" ? "Mark as draft" : "Mark final"}
                      </Button>
                    )}
                  </div>

                  {/* Planner link. Shown explicitly, with an unlink control: a link
                      is an act the writer performed, never one inherited from
                      context (docs/PLANNER_AUTOLINK_BUGFIX_SPEC.md). */}
                  <div className="mt-3 pt-3 border-t border-line flex items-center gap-2 flex-wrap">
                    {linkedRowId ? (
                      <>
                        <span className="text-xs text-ink-secondary min-w-0 truncate">
                          Planner:{" "}
                          <a href={`/planner?copy=${encodeURIComponent(selectedCopyId ?? "")}`} className="text-accent hover:underline">
                            {linkedRow?.name ?? linkedRowId}
                          </a>
                          {!linkedRow && <span className="text-ink-muted"> (row not found — it may have been deleted)</span>}
                        </span>
                        <Button size="sm" variant="ghost" loading={linkBusy} onClick={unlinkRow} title="Detach this email from the planner row">
                          Unlink
                        </Button>
                      </>
                    ) : (
                      <>
                        <span className="text-xs text-ink-muted">Not on the planner.</span>
                        <Button
                          size="sm"
                          variant="ghost"
                          disabled={!selectedEmail.campaign}
                          title={selectedEmail.campaign ? "Put this email on the planner" : "Write this email first"}
                          onClick={() => setShowLinkPicker(true)}
                        >
                          Link to planner
                        </Button>
                      </>
                    )}
                  </div>
                </div>

                {/* Where this email sits, branches included — the same description
                    the flow brain is given, so the writer can see what it will be
                    told about the reader's state. */}
                <div className="mb-4">
                  <div className="t-label mb-1.5">The reader&apos;s path here</div>
                  <pre className="text-[11px] text-ink-secondary bg-sunken border border-line rounded-md p-3 whitespace-pre-wrap leading-relaxed font-sans">
                    {fg.pathContext(graph, selectedNodeId)}
                  </pre>
                </div>

                {selectedEmail.campaign ? (
                  <CampaignCanvas
                    campaign={selectedEmail.campaign}
                    expandedBrief={expandedBrief}
                    chosenConceit={conceit}
                    assistsDisabledReason={assistsDisabledReason}
                    // Drives the canvas's real-review auto-fill for a standalone
                    // `reviews` section, which also records each review's
                    // provenance. Without it an empty Review slot on a flow email
                    // could never be filled with a real review — the same half-fix
                    // the generate route had (REVIEWS_MODULE_SPEC.md §8).
                    featuredProduct={productsFromStructure(selectedEmail.section_structure)[0]}
                    retrievedExamples={[]}
                    sectionStructure={selectedEmail.section_structure}
                    toneDial={DEFAULT_TONE_DIAL}
                    isGenerating={generatingNodeId === selectedNodeId}
                    onChange={onCanvasChange}
                    onInsertAt={(index, type, specPatch) => {
                      if (canvasState) commitSections(canvasSections.insertAt(canvasState, index, type, specPatch));
                    }}
                    onDeleteSection={(id) => { if (canvasState) commitSections(canvasSections.removeSection(canvasState, id)); }}
                    onMoveSection={(id, dir) => { if (canvasState) commitSections(canvasSections.moveSection(canvasState, id, dir)); }}
                    onReorder={(from, to) => { if (canvasState) commitSections(canvasSections.reorderSections(canvasState, from, to)); }}
                  />
                ) : (
                  <EmptyState
                    className="border border-dashed border-line rounded-lg"
                    title="Not written yet"
                    description="Add any highlights above, then Write this email — the flow brain drafts it as this email of the sequence, on this branch."
                  />
                )}
              </div>
            </aside>
          )}
        </div>
      )}

      {showCreate && <CreateFlowModal onClose={() => setShowCreate(false)} onCreate={createFlow} />}
      {showLinkPicker && flow && selectedEmail && (
        <LinkPlannerModal
          defaultName={`${flow.name} — Email ${selectedEmail.position}`}
          rows={plannerRows}
          busy={linkBusy}
          onClose={() => setShowLinkPicker(false)}
          onCreate={async (name, ymd) => { if (await createRowAndLink(name, ymd)) setShowLinkPicker(false); }}
          onPick={async (rowId) => { if (await linkToRow(rowId)) setShowLinkPicker(false); }}
        />
      )}
      {confirmDeleteFlow && (
        <ConfirmModal
          open
          danger
          title="Delete flow?"
          body="This removes the flow and all its written emails. This can't be undone."
          confirmLabel="Delete"
          onConfirm={() => deleteFlow(confirmDeleteFlow)}
          onClose={() => setConfirmDeleteFlow(null)}
        />
      )}
      {confirmDeleteNode && (() => {
        const node = fg.nodeById(graph, confirmDeleteNode.id);
        const isSplit = node?.kind === "split";
        const n = confirmDeleteNode.emailCount;
        return (
          <ConfirmModal
            open
            danger
            title={isSplit ? "Delete this branch?" : "Delete this step?"}
            body={
              isSplit
                ? `This removes the branch and everything below it${n > 0 ? `, including ${n} email${n === 1 ? "" : "s"}` : ""}. This can't be undone.`
                : `This removes the email and its copy. This can't be undone.`
            }
            confirmLabel="Delete"
            onConfirm={() => doDeleteNode(confirmDeleteNode.id)}
            onClose={() => setConfirmDeleteNode(null)}
          />
        );
      })()}
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
            Scaffolds {FLOW_PLAYBOOKS[type].emails.length} email{FLOW_PLAYBOOKS[type].emails.length === 1 ? "" : "s"} you can write one at a time. You can rename the flow and change its goal afterwards.
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

// ---- Link-to-planner modal -------------------------------------------------
// A flow email gets its OWN planner row by default rather than borrowing a
// campaign's. A PlannerRow models a scheduled send — planned_send_at, and "sent"
// derived from that date passing — whereas a flow email is triggered and
// evergreen. The new row is marked `flow_email`, which is what keeps it out of
// metrics sync and Copy Performance while still putting the email on the calendar
// as a build/QA task (docs/FLOW_BUILDER_FIXES_SPEC.md §3.2, option a).
//
// Picking an EXISTING row is offered too, but only among rows already marked
// flow_email — re-linking after an unlink is the case that needs it. Taking over a
// campaign row would silently turn a real send into a non-send and drop it out of
// the revenue numbers, which is exactly the corruption row_kind exists to prevent.
function LinkPlannerModal({
  defaultName,
  rows,
  busy,
  onClose,
  onCreate,
  onPick,
}: {
  defaultName: string;
  rows: PlannerRow[];
  busy: boolean;
  onClose: () => void;
  onCreate: (name: string, ymd: string) => void;
  onPick: (rowId: string) => void;
}) {
  const [name, setName] = useState(defaultName);
  const [ymd, setYmd] = useState(todayYMD());

  const reusable = rows
    .filter((r) => r.row_kind === "flow_email" && !r.copy_campaign_id)
    .sort((a, b) => b.planned_send_at.localeCompare(a.planned_send_at));

  return (
    <Modal
      open
      onClose={onClose}
      title="Put this email on the planner"
      footer={
        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button variant="primary" loading={busy} disabled={!name.trim()} onClick={() => onCreate(name.trim(), ymd)}>
            Create row &amp; link
          </Button>
        </div>
      }
    >
      <div className="space-y-4">
        <p className="text-xs text-ink-muted leading-relaxed">
          A flow email is triggered and evergreen, so its row is a <strong>build / QA task</strong>, not a send.
          It shows on the calendar on the date you pick and is excluded from metrics sync and Copy Performance.
        </p>

        <div>
          <label className="t-label block mb-1.5">Row name</label>
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            className="w-full text-sm border border-line rounded-md px-3 py-2 bg-surface focus:outline-none focus:border-accent transition-colors"
          />
        </div>

        <div>
          <label className="t-label block mb-1.5">Show it on</label>
          <input
            type="date"
            value={ymd}
            onChange={(e) => setYmd(e.target.value || todayYMD())}
            className="w-full text-sm border border-line rounded-md px-3 py-2 bg-surface focus:outline-none focus:border-accent transition-colors"
          />
        </div>

        {reusable.length > 0 && (
          <div>
            <div className="t-label mb-1.5">…or reuse an existing flow-email row</div>
            <div className="max-h-48 overflow-y-auto space-y-1.5">
              {reusable.map((r) => (
                <button
                  key={r.id}
                  disabled={busy}
                  onClick={() => onPick(r.id)}
                  className="w-full text-left p-2.5 rounded-md border border-line hover:border-accent bg-surface hover:bg-accent-50 disabled:opacity-50 transition-colors"
                >
                  <div className="text-sm text-ink truncate">{r.name}</div>
                  <div className="text-[11px] text-ink-muted mt-0.5">{r.planned_send_at.slice(0, 10)}</div>
                </button>
              ))}
            </div>
          </div>
        )}
      </div>
    </Modal>
  );
}
