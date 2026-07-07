"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";

const FEATURES = [
  { href: "/copy-builder", label: "Copy", sublabel: "Builder" },
  { href: "/dashboard", label: "Dash", sublabel: "board" },
  { href: "/planner", label: "Plan", sublabel: "ner" },
  { href: "/reports", label: "Report", sublabel: "weekly" },
];

export default function AppNav() {
  const pathname = usePathname();

  // The login screen renders full-bleed without the app chrome.
  if (pathname === "/login") return null;

  async function logout() {
    await fetch("/api/logout", { method: "POST" });
    window.location.href = "/login";
  }

  return (
    <aside className="w-[72px] shrink-0 border-r border-slate-200 bg-white flex flex-col">
      <div className="px-2 pt-4 pb-3 text-center">
        <div className="font-mono text-[10px] text-slate-400 uppercase tracking-wide leading-tight">
          Raycon
        </div>
      </div>
      <nav className="flex flex-col gap-1 px-2">
        {FEATURES.map((f) => {
          const active = pathname === f.href || pathname.startsWith(f.href + "/");
          return (
            <Link
              key={f.href}
              href={f.href}
              className={`flex flex-col items-center justify-center rounded-md py-3 transition-colors ${
                active
                  ? "bg-slate-900 text-white"
                  : "text-slate-600 hover:bg-slate-100"
              }`}
            >
              <span className="text-xs font-medium leading-tight">{f.label}</span>
              <span className={`text-[10px] leading-tight ${active ? "text-slate-300" : "text-slate-400"}`}>
                {f.sublabel}
              </span>
            </Link>
          );
        })}
      </nav>
      <button
        onClick={logout}
        title="Sign out"
        className="mt-auto mx-2 mb-3 rounded-md py-2 text-[10px] font-medium text-slate-400 hover:bg-slate-100 hover:text-slate-600 transition-colors"
      >
        Sign out
      </button>
    </aside>
  );
}
