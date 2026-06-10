"use client";
import { useRef, useEffect } from "react";

interface Props {
  value: string;
  onChange: (v: string) => void;
  className?: string;
  placeholder?: string;
  multiline?: boolean;
}

export default function EditableField({ value, onChange, className = "", placeholder, multiline = true }: Props) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (ref.current && ref.current.innerText !== value) {
      ref.current.innerText = value;
    }
  }, [value]);

  return (
    <div
      ref={ref}
      contentEditable
      suppressContentEditableWarning
      onInput={(e) => onChange((e.target as HTMLDivElement).innerText)}
      onKeyDown={(e) => {
        if (!multiline && e.key === "Enter") e.preventDefault();
      }}
      data-placeholder={placeholder}
      className={`min-h-[1.5em] text-slate-900 leading-relaxed cursor-text px-2 py-1 rounded transition-colors ${className}`}
      style={{ whiteSpace: "pre-wrap", wordBreak: "break-word" }}
    />
  );
}
