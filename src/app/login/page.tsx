"use client";

import { useState } from "react";

export default function LoginPage() {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    setLoading(true);
    try {
      const res = await fetch("/api/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username, password }),
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok && data.ok) {
        const from = new URLSearchParams(window.location.search).get("from");
        window.location.href = from || "/";
        return;
      }
      setError(data.error || "Sign in failed. Please try again.");
    } catch {
      setError("Network error. Please try again.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="min-h-full flex items-center justify-center px-4 py-12">
      <div className="w-full max-w-sm">
        {/* Brand */}
        <div className="flex flex-col items-center mb-8">
          <RayconIcon />
          <RayconWordmark className="mt-4 h-5 text-slate-900" />
          <p className="mt-3 font-mono text-[11px] uppercase tracking-[0.2em] text-slate-400">
            Copy Builder
          </p>
        </div>

        {/* Card */}
        <form
          onSubmit={handleSubmit}
          className="bg-white border border-slate-200 rounded-2xl shadow-sm p-7"
        >
          <h1 className="text-lg font-semibold text-slate-900">Sign in</h1>
          <p className="mt-1 text-sm text-slate-500">
            Enter your credentials to continue.
          </p>

          <div className="mt-6 space-y-4">
            <Field
              label="Username"
              type="text"
              value={username}
              onChange={setUsername}
              autoComplete="username"
              autoFocus
            />
            <Field
              label="Password"
              type="password"
              value={password}
              onChange={setPassword}
              autoComplete="current-password"
            />
          </div>

          {error && (
            <div className="mt-4 text-sm text-red-600 bg-red-50 border border-red-100 rounded-lg px-3 py-2">
              {error}
            </div>
          )}

          <button
            type="submit"
            disabled={loading || !username || !password}
            className="mt-6 w-full rounded-lg bg-slate-900 text-white text-sm font-medium py-2.5 transition-colors hover:bg-slate-800 disabled:opacity-40 disabled:cursor-not-allowed"
          >
            {loading ? "Signing in…" : "Sign in"}
          </button>
        </form>

        <p className="mt-6 text-center font-mono text-[10px] uppercase tracking-[0.2em] text-slate-300">
          Raycon Internal Tools
        </p>
      </div>
    </div>
  );
}

function Field({
  label,
  type,
  value,
  onChange,
  autoComplete,
  autoFocus,
}: {
  label: string;
  type: string;
  value: string;
  onChange: (v: string) => void;
  autoComplete?: string;
  autoFocus?: boolean;
}) {
  return (
    <label className="block">
      <span className="block text-xs font-medium text-slate-600 mb-1.5">
        {label}
      </span>
      <input
        type={type}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        autoComplete={autoComplete}
        autoFocus={autoFocus}
        className="w-full rounded-lg border border-slate-200 bg-slate-50/50 px-3 py-2.5 text-sm text-slate-900 placeholder-slate-400 outline-none transition focus:border-slate-900 focus:bg-white focus:ring-2 focus:ring-slate-900/10"
      />
    </label>
  );
}

// Raycon-style audio mark: a soundwave in a dark rounded tile.
function RayconIcon() {
  const bars = [10, 18, 26, 18, 10];
  return (
    <div className="h-14 w-14 rounded-2xl bg-slate-900 flex items-center justify-center shadow-sm">
      <svg width="30" height="30" viewBox="0 0 30 30" aria-hidden="true">
        {bars.map((h, i) => (
          <rect
            key={i}
            x={4 + i * 5.2}
            y={(30 - h) / 2}
            width="2.6"
            height={h}
            rx="1.3"
            fill="white"
            opacity={0.55 + 0.45 * (1 - Math.abs(i - 2) / 2)}
          />
        ))}
      </svg>
    </div>
  );
}

// "raycon" wordmark rendered as text so it always matches the app font.
function RayconWordmark({ className = "" }: { className?: string }) {
  return (
    <span
      className={`font-semibold tracking-tight leading-none ${className}`}
      style={{ fontSize: "22px" }}
    >
      raycon
    </span>
  );
}
