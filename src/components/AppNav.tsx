"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";

// Grouped, labeled, searchable left sidebar (the app's primary nav). Replaces the
// old 72px icon rail. Light surface, hairline border, ~240px wide. Nav items are
// organized under tiny uppercase section headers; the active item takes the
// accent (tinted bg + left bar + accent text). The search box filters the nav
// client-side and is focusable with ⌘K — a real affordance, not decoration.

// 1.5px-stroke line icons (20px), currentColor so active/hover tinting works.
const SVG = "w-[18px] h-[18px] shrink-0";
const svgProps = {
  className: SVG,
  viewBox: "0 0 24 24",
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 1.5,
  strokeLinecap: "round" as const,
  strokeLinejoin: "round" as const,
  "aria-hidden": true,
};

function CopyIcon() {
  return (<svg {...svgProps}><path d="M12 20h9" /><path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4Z" /></svg>);
}
function PlannerIcon() {
  return (<svg {...svgProps}><rect x="3" y="4" width="18" height="18" rx="2" /><path d="M16 2v4M8 2v4M3 10h18" /></svg>);
}
function PromotionsIcon() {
  return (<svg {...svgProps}><rect x="3" y="4" width="18" height="18" rx="2" /><path d="M16 2v4M8 2v4M3 10h18" /><circle cx="8" cy="15" r="1.4" fill="currentColor" stroke="none" /><path d="M12 15h4" /></svg>);
}
function FlowsIcon() {
  return (<svg {...svgProps}><circle cx="5" cy="6" r="2" /><circle cx="19" cy="6" r="2" /><circle cx="12" cy="18" r="2" /><path d="M5 8v2a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8M12 14v2" /></svg>);
}
function CampaignsIcon() {
  return (<svg {...svgProps}><path d="m3 11 18-5v12L3 14v-3Z" /><path d="M11.6 16.8a3 3 0 1 1-5.8-1.6" /></svg>);
}
function ReportsIcon() {
  return (<svg {...svgProps}><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" /><path d="M14 2v6h6" /><path d="M9 13h6M9 17h6" /></svg>);
}
function SandboxIcon() {
  return (<svg {...svgProps}><path d="M9 3h6M10 3v6.5L5 18a2 2 0 0 0 1.8 3h10.4A2 2 0 0 0 19 18l-5-8.5V3" /><path d="M7 15h10" /></svg>);
}
function LifecycleIcon() {
  return (<svg {...svgProps}><rect x="3" y="4" width="5" height="16" rx="1" /><rect x="10" y="4" width="5" height="11" rx="1" /><rect x="17" y="4" width="4" height="7" rx="1" /></svg>);
}
function SignOutIcon() {
  return (<svg {...svgProps}><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" /><path d="m16 17 5-5-5-5" /><path d="M21 12H9" /></svg>);
}
function SearchIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5}
      strokeLinecap="round" strokeLinejoin="round" aria-hidden className="w-4 h-4 shrink-0">
      <circle cx="11" cy="11" r="7" /><path d="m21 21-4.3-4.3" />
    </svg>
  );
}

type NavItem = { href: string; label: string; Icon: () => React.JSX.Element; badge?: string };
type NavGroup = { title: string; items: NavItem[] };

// Raycon's routes, mapped into grouped sections. Dashboard's old in-page
// Flows/Campaigns tabs now live here under MEASURE (per the revamp), alongside
// Reports; there is no standalone /dashboard content (it redirects to Flows).
const GROUPS: NavGroup[] = [
  {
    title: "Create",
    items: [
      { href: "/copy-builder", label: "Copy Builder", Icon: CopyIcon, badge: "AI" },
      { href: "/flows", label: "Flow Builder", Icon: FlowsIcon, badge: "NEW" },
    ],
  },
  {
    title: "Plan",
    items: [
      { href: "/planner", label: "Planner", Icon: PlannerIcon },
      { href: "/promotions", label: "Promotions", Icon: PromotionsIcon },
    ],
  },
  {
    title: "Measure",
    items: [
      { href: "/dashboard/flows", label: "Flows", Icon: FlowsIcon },
      { href: "/dashboard/campaigns", label: "Campaigns", Icon: CampaignsIcon },
      { href: "/reports", label: "Reports", Icon: ReportsIcon },
      { href: "/lifecycle", label: "Lifecycle", Icon: LifecycleIcon, badge: "NEW" },
    ],
  },
  // Diagnostic surface — hidden in production (the /sandbox routes are gated to
  // dev / ENABLE_DEBUG_ROUTES server-side; keep the nav in step). NODE_ENV is
  // inlined at build time on the client.
  ...(process.env.NODE_ENV !== "production"
    ? [{ title: "Lab", items: [{ href: "/sandbox", label: "Sandbox", Icon: SandboxIcon }] }]
    : []),
];

export default function AppNav() {
  const pathname = usePathname();
  const [query, setQuery] = useState("");
  const searchRef = useRef<HTMLInputElement>(null);

  // ⌘K / Ctrl-K focuses the nav search from anywhere.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        searchRef.current?.focus();
        searchRef.current?.select();
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  // Client-side filter over item labels; groups with no match drop out.
  const groups = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return GROUPS;
    return GROUPS
      .map((g) => ({ ...g, items: g.items.filter((i) => i.label.toLowerCase().includes(q)) }))
      .filter((g) => g.items.length > 0);
  }, [query]);

  // The login screen renders full-bleed without the app chrome.
  if (pathname === "/login") return null;

  async function logout() {
    await fetch("/api/logout", { method: "POST" });
    window.location.href = "/login";
  }

  const isActive = (href: string) => pathname === href || pathname.startsWith(href + "/");

  return (
    <aside className="w-60 shrink-0 border-r border-line bg-surface flex flex-col h-full">
      {/* Brand lockup */}
      <div className="px-4 pt-4 pb-3 flex items-center gap-2.5">
        <div className="w-8 h-8 rounded-md bg-ink text-white text-sm font-semibold flex items-center justify-center shrink-0">R</div>
        <div className="min-w-0">
          <div className="text-sm font-semibold text-ink leading-tight truncate">Raycon</div>
          <div className="text-[11px] text-ink-muted leading-tight truncate">Campaign tools</div>
        </div>
      </div>

      {/* Search + ⌘K hint */}
      <div className="px-3 pb-2">
        <div className="relative flex items-center">
          <span className="absolute left-2.5 text-ink-muted pointer-events-none"><SearchIcon /></span>
          <input
            ref={searchRef}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Escape") setQuery(""); }}
            placeholder="Search"
            aria-label="Search navigation"
            className="w-full rounded-md border border-line bg-canvas pl-8 pr-12 py-2 text-sm text-ink placeholder:text-ink-muted focus:outline-none focus:border-accent focus:bg-surface transition-colors"
          />
          <kbd className="absolute right-2 text-[10px] font-medium text-ink-muted bg-chrome border border-line rounded px-1.5 py-0.5 pointer-events-none select-none">⌘K</kbd>
        </div>
      </div>

      {/* Grouped nav */}
      <nav className="flex-1 overflow-y-auto px-3 py-2 flex flex-col gap-4">
        {groups.map((group) => (
          <div key={group.title} className="flex flex-col gap-0.5">
            <div className="t-label px-2 pb-1">{group.title}</div>
            {group.items.map(({ href, label, Icon, badge }) => {
              const active = isActive(href);
              return (
                <Link
                  key={href}
                  href={href}
                  aria-current={active ? "page" : undefined}
                  className={`relative flex items-center gap-2.5 rounded-md pl-3 pr-2 py-2 text-sm font-medium transition-colors duration-150 ease-out-soft ${
                    active ? "bg-accent-50 text-accent" : "text-ink-secondary hover:bg-chrome hover:text-ink"
                  }`}
                >
                  {active && <span aria-hidden className="absolute left-0.5 top-1.5 bottom-1.5 w-0.5 rounded-full bg-accent" />}
                  <Icon />
                  <span className="truncate flex-1">{label}</span>
                  {badge && (
                    <span className={`text-[10px] font-semibold tracking-wide rounded px-1.5 py-0.5 ${
                      active ? "bg-accent-200/60 text-accent" : "bg-chrome text-ink-muted"
                    }`}>
                      {badge}
                    </span>
                  )}
                </Link>
              );
            })}
          </div>
        ))}
        {groups.length === 0 && (
          <div className="px-2 py-1 text-sm text-ink-muted">No matches</div>
        )}
      </nav>

      {/* Admin — sign out pinned to the bottom */}
      <div className="border-t border-line px-3 py-2">
        <button
          onClick={logout}
          aria-label="Sign out"
          className="w-full flex items-center gap-2.5 rounded-md pl-3 pr-2 py-2 text-sm font-medium text-ink-muted hover:bg-chrome hover:text-ink-secondary transition-colors duration-150 ease-out-soft"
        >
          <SignOutIcon />
          <span className="truncate">Sign out</span>
        </button>
      </div>
    </aside>
  );
}
