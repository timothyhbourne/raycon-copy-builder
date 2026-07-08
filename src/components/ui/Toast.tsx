"use client";
import { useSyncExternalStore } from "react";

// Minimal toast manager: a module-level store + fire-from-anywhere `toast.*`
// helpers + a <ToastViewport /> rendered once in the root layout. No library.

type ToastVariant = "success" | "error" | "info";
interface ToastItem { id: number; message: string; variant: ToastVariant }

let items: ToastItem[] = [];
const listeners = new Set<() => void>();
let nextId = 1;

function emit() { for (const l of listeners) l(); }
function subscribe(l: () => void) { listeners.add(l); return () => { listeners.delete(l); }; }
function getSnapshot() { return items; }

function remove(id: number) {
  items = items.filter((t) => t.id !== id);
  emit();
}
function push(message: string, variant: ToastVariant) {
  const id = nextId++;
  items = [...items, { id, message, variant }];
  emit();
  setTimeout(() => remove(id), 3500);
  return id;
}

export const toast = {
  success: (m: string) => push(m, "success"),
  error: (m: string) => push(m, "error"),
  info: (m: string) => push(m, "info"),
};

const TONE: Record<ToastVariant, string> = {
  success: "border-success-200 bg-success-50 text-success-600",
  error: "border-danger-200 bg-danger-50 text-danger-600",
  info: "border-line bg-surface text-ink-secondary",
};

export function ToastViewport() {
  const toasts = useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
  return (
    <div className="fixed bottom-4 right-4 z-[100] flex flex-col gap-2 pointer-events-none" aria-live="polite">
      {toasts.map((t) => (
        <div
          key={t.id}
          role="status"
          className={`rc-animate-toast-in pointer-events-auto flex items-start gap-3 rounded-md border px-3.5 py-2.5 text-sm shadow-pop max-w-sm ${TONE[t.variant]}`}
        >
          <span className="leading-snug">{t.message}</span>
          <button onClick={() => remove(t.id)} aria-label="Dismiss" className="ml-auto shrink-0 opacity-60 hover:opacity-100 transition-opacity">
            ✕
          </button>
        </div>
      ))}
    </div>
  );
}
