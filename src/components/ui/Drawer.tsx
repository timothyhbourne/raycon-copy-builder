"use client";
import React, { useEffect, useRef, useId } from "react";

interface DrawerProps {
  open: boolean;
  onClose: () => void;
  title?: React.ReactNode;
  children?: React.ReactNode;
  footer?: React.ReactNode;
}

const FOCUSABLE = 'a[href],button:not([disabled]),textarea:not([disabled]),input:not([disabled]),select:not([disabled]),[tabindex]:not([tabindex="-1"])';

// Right-side drawer with the same a11y contract as Modal (ESC closes,
// click-outside closes, focus moved in on open and restored on close, Tab
// cycles within, aria-modal + labelled title, body scroll locked). Slides in
// from the right in 250ms — preferred over a centered modal for editing flows
// where the underlying content (the calendar) stays partially in view.
export default function Drawer({ open, onClose, title, children, footer }: DrawerProps) {
  const panelRef = useRef<HTMLDivElement>(null);
  const prevFocus = useRef<Element | null>(null);
  const titleId = useId();

  useEffect(() => {
    if (!open) return;
    prevFocus.current = document.activeElement;
    const panel = panelRef.current;
    const focusables = () => Array.from(panel?.querySelectorAll<HTMLElement>(FOCUSABLE) ?? []);
    (focusables()[0] ?? panel)?.focus();

    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") { e.stopPropagation(); onClose(); return; }
      if (e.key === "Tab") {
        const list = focusables();
        if (list.length === 0) { e.preventDefault(); return; }
        const active = document.activeElement as HTMLElement;
        const idx = list.indexOf(active);
        if (e.shiftKey && idx <= 0) { e.preventDefault(); list[list.length - 1].focus(); }
        else if (!e.shiftKey && idx === list.length - 1) { e.preventDefault(); list[0].focus(); }
      }
    };
    document.addEventListener("keydown", onKey, true);
    return () => {
      document.removeEventListener("keydown", onKey, true);
      document.body.style.overflow = prevOverflow;
      (prevFocus.current as HTMLElement | null)?.focus?.();
    };
  }, [open, onClose]);

  if (!open) return null;
  return (
    <div
      className="fixed inset-0 z-[90] flex justify-end bg-black/40 rc-animate-overlay-in"
      onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={title ? titleId : undefined}
        tabIndex={-1}
        className="rc-animate-drawer-in h-full w-full max-w-lg bg-surface shadow-pop flex flex-col focus:outline-none"
      >
        {title && (
          <div id={titleId} className="flex items-center justify-between px-5 py-4 border-b border-line shrink-0">
            <span className="font-mono text-xs text-ink-muted uppercase tracking-wide">{title}</span>
            <button onClick={onClose} aria-label="Close" title="Close (Esc)"
              className="text-ink-muted hover:text-ink text-sm transition-colors">✕</button>
          </div>
        )}
        <div className="flex-1 overflow-y-auto px-5 py-4">{children}</div>
        {footer && <div className="border-t border-line px-5 py-3 flex items-center gap-2 shrink-0">{footer}</div>}
      </div>
    </div>
  );
}
