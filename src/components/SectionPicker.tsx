"use client";
import { useEffect, useMemo, useRef, useState } from "react";
import type { SectionSpec, SectionType } from "@/lib/schemas";
import { sectionElementNames } from "@/lib/schemas";
import {
  SECTION_META, SECTION_GROUP_LABELS, SECTION_GROUP_ORDER, searchSectionTypes,
} from "@/lib/section-catalogue-meta";
import Modal from "./ui/Modal";
import Button from "./ui/Button";
import SectionConfigFields, { isSectionConfigComplete } from "./SectionConfigFields";

// The section picker: a searchable, keyboard-operable modal replacing the old
// hover-only dropdown of raw type names (spec §3.2).
//
// Three things it fixes: every type is reachable (product_grid and bundle
// included), each card says what the section IS and what elements it carries, and
// the element list is read from sectionElementNames() so the preview can never
// drift from the real catalogue.
//
// Types marked needsConfig advance to a second step to collect their
// configuration, so they insert fully formed rather than as an empty shell.

interface Props {
  open: boolean;
  /** Where the section will land, for the modal's title. null = append. */
  position?: { index: number; label: string } | null;
  onClose: () => void;
  onInsert: (type: SectionType, specPatch: Partial<SectionSpec>) => void;
  /** Featured products, for the config step's product bindings. */
  selectedProducts?: { id: string; name: string }[];
}

/** Mounted only while open, so its state is fresh by construction — a stale query
 * or cursor from last time can't survive, and no effect is needed to clear one. */
export default function SectionPicker(props: Props) {
  if (!props.open) return null;
  return <SectionPickerPanel {...props} />;
}

function SectionPickerPanel({ position, onClose, onInsert, selectedProducts = [] }: Props) {
  const [query, setQuery] = useState("");
  const [cursor, setCursor] = useState(0);
  // Step 2: a chosen type whose configuration is still being collected.
  const [configuring, setConfiguring] = useState<SectionSpec | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  const matches = useMemo(() => searchSectionTypes(query), [query]);

  // Modal moves focus to its first focusable; take it for the search box so typing
  // filters immediately.
  useEffect(() => {
    const t = setTimeout(() => inputRef.current?.focus(), 0);
    return () => clearTimeout(t);
  }, []);

  // Keep the highlighted card in view when arrowing past the fold.
  useEffect(() => {
    if (configuring) return;
    listRef.current?.querySelector<HTMLElement>('[data-cursor="true"]')?.scrollIntoView({ block: "nearest" });
  }, [cursor, configuring]);

  const choose = (type: SectionType) => {
    if (SECTION_META[type].needsConfig) {
      // id is a placeholder: campaign-sections.ts mints the real one, shared with
      // the section it creates.
      setConfiguring({ id: "pending", type, ...defaultConfigFor(type) });
      return;
    }
    onInsert(type, {});
  };

  const confirmConfigured = () => {
    if (!configuring || !isSectionConfigComplete(configuring)) return;
    const { id: _id, type, ...patch } = configuring;
    onInsert(type, patch);
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (configuring) {
      // In the config step ↵ confirms, but not while a <select> is open.
      if (e.key === "Enter" && (e.target as HTMLElement).tagName !== "SELECT") {
        e.preventDefault();
        confirmConfigured();
      }
      return;
    }
    if (e.key === "ArrowDown") { e.preventDefault(); setCursor((c) => Math.min(c + 1, matches.length - 1)); }
    else if (e.key === "ArrowUp") { e.preventDefault(); setCursor((c) => Math.max(c - 1, 0)); }
    else if (e.key === "Enter") { e.preventDefault(); if (matches[cursor]) choose(matches[cursor]); }
  };

  const title = configuring
    ? `${SECTION_META[configuring.type].label} — set it up`
    : position
      ? `Insert section ${position.label}`
      : "Add section";

  return (
    <Modal
      open
      onClose={onClose}
      title={title}
      size="lg"
      footer={
        configuring ? (
          <>
            <Button variant="ghost" onClick={() => setConfiguring(null)}>Back</Button>
            <Button
              variant="primary"
              onClick={confirmConfigured}
              disabled={!isSectionConfigComplete(configuring)}
              title={isSectionConfigComplete(configuring) ? undefined : "Finish the setup above first"}
            >
              Insert
            </Button>
          </>
        ) : (
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
        )
      }
    >
      <div onKeyDown={onKeyDown}>
        {configuring ? (
          <div className="space-y-4">
            <p className="text-sm text-ink-secondary leading-relaxed">
              {SECTION_META[configuring.type].description}
            </p>
            <div className="rounded-md border border-line bg-sunken p-3">
              <SectionConfigFields
                spec={configuring}
                onPatch={(patch) => setConfiguring((c) => (c ? { ...c, ...patch } : c))}
                selectedProducts={selectedProducts}
                includeProductCardBinding
              />
            </div>
            <ElementPreview spec={configuring} />
          </div>
        ) : (
          <>
            <input
              ref={inputRef}
              type="text"
              value={query}
              onChange={(e) => { setQuery(e.target.value); setCursor(0); }}
              placeholder="Search sections…"
              aria-label="Search sections"
              className="w-full text-sm border border-line rounded-md px-3 py-2 bg-white focus:outline-none focus:border-line-strong mb-1"
            />
            <div className="text-[11px] text-ink-muted mb-3">
              ↑↓ to move · ↵ to insert · esc to close
            </div>

            <div ref={listRef} className="max-h-[52vh] overflow-y-auto -mx-1 px-1">
              {matches.length === 0 && (
                <div className="text-sm text-ink-muted py-6 text-center">
                  Nothing matches “{query}”.
                </div>
              )}
              {SECTION_GROUP_ORDER.map((group) => {
                const inGroup = matches.filter((t) => SECTION_META[t].group === group);
                if (!inGroup.length) return null;
                return (
                  <div key={group} className="mb-3 last:mb-0">
                    <div className="t-label text-ink-secondary mb-1.5">{SECTION_GROUP_LABELS[group]}</div>
                    <div className="space-y-1">
                      {inGroup.map((type) => {
                        const meta = SECTION_META[type];
                        const isCursor = matches[cursor] === type;
                        return (
                          <button
                            key={type}
                            type="button"
                            data-cursor={isCursor ? "true" : undefined}
                            onMouseEnter={() => setCursor(matches.indexOf(type))}
                            onClick={() => choose(type)}
                            className={`w-full text-left rounded-md border px-3 py-2 transition-colors ${
                              isCursor ? "border-line-strong bg-sunken" : "border-line hover:border-line-strong"
                            }`}
                          >
                            <div className="flex items-baseline gap-2">
                              <span className="text-sm font-medium text-ink">{meta.label}</span>
                              {meta.needsConfig && (
                                <span className="text-[11px] text-ink-muted">needs setup</span>
                              )}
                            </div>
                            <div className="text-xs text-ink-tertiary mt-0.5 leading-relaxed">{meta.description}</div>
                            <div className="text-[11px] text-ink-muted mt-1 truncate">
                              {sectionElementNames({ type }).join(" · ")}
                            </div>
                          </button>
                        );
                      })}
                    </div>
                  </div>
                );
              })}
            </div>
          </>
        )}
      </div>
    </Modal>
  );
}

/** The elements this configured section will carry — read from the catalogue, so
 * a bundle's four layouts show their genuinely different element lists. */
function ElementPreview({ spec }: { spec: SectionSpec }) {
  const elements = sectionElementNames(spec);
  return (
    <div>
      <div className="t-label text-ink-secondary mb-1">Elements it will carry</div>
      <div className="text-xs text-ink-tertiary leading-relaxed">{elements.join(" · ")}</div>
    </div>
  );
}

/** Sensible starting configuration, so the config step opens on something valid
 * rather than an empty form. */
function defaultConfigFor(type: SectionType): Partial<SectionSpec> {
  if (type === "product_grid") return { grid_cols: 2, grid_rows: 2 };
  if (type === "bundle") return { bundle_mode: "custom", bundle_template: "unified", bundle_products: [] };
  return {};
}
