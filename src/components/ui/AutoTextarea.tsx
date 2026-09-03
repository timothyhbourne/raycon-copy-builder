"use client";
import { useEffect, useLayoutEffect, useRef } from "react";

// A textarea that grows to fit what's in it.
//
// The resize grip it replaces is a bad deal for the field it was on: the planner's
// notes/learnings box shipped at 70px with `resize-y`, so reading anything longer
// than three lines meant dragging a corner open every single time the drawer was
// opened — the height is not a preference worth remembering, it is just a
// consequence of the text. Growing is the honest behaviour, and the drawer already
// scrolls, so there is no height to fight over.
//
// Deliberately uncapped: "I have to drag it down if there's a lot of information" is
// solved by showing all of it, not by trading a drag handle for an inner scrollbar.

interface Props {
  value: string;
  onChange: (v: string) => void;
  /** Height floor, in rows, so an empty field still reads as a place to write. */
  minRows?: number;
  placeholder?: string;
  className?: string;
  "aria-label"?: string;
}

// useLayoutEffect measures before paint (no flash of a one-line box on open), but it
// warns during SSR — the client-only alias keeps both.
const useIsomorphicLayoutEffect = typeof window === "undefined" ? useEffect : useLayoutEffect;

export default function AutoTextarea({ value, onChange, minRows = 3, placeholder, className = "", ...rest }: Props) {
  const ref = useRef<HTMLTextAreaElement>(null);

  const fit = () => {
    const el = ref.current;
    if (!el) return;
    // Collapse first: scrollHeight only shrinks back if the element isn't already
    // holding the taller height open.
    el.style.height = "auto";
    el.style.height = `${el.scrollHeight}px`;
  };

  useIsomorphicLayoutEffect(fit, [value]);
  // Wrapping changes with the panel width, and so does the height it needs.
  useEffect(() => {
    const el = ref.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(fit);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  return (
    <textarea
      ref={ref}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      rows={minRows}
      placeholder={placeholder}
      aria-label={rest["aria-label"]}
      className={`resize-none overflow-hidden ${className}`}
    />
  );
}
