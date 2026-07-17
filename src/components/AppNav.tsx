"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";

// Simple 1.5px-stroke line icons (20px), currentColor so active/hover tinting
// works via text color.
const SVG = "w-5 h-5";
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
function DashboardIcon() {
  return (<svg {...svgProps}><path d="M3 3v18h18" /><rect x="7" y="10" width="3" height="7" /><rect x="14" y="6" width="3" height="11" /></svg>);
}
function PlannerIcon() {
  return (<svg {...svgProps}><rect x="3" y="4" width="18" height="18" rx="2" /><path d="M16 2v4M8 2v4M3 10h18" /></svg>);
}
function ReportsIcon() {
  return (<svg {...svgProps}><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" /><path d="M14 2v6h6" /><path d="M9 13h6M9 17h6" /></svg>);
}
function SignOutIcon() {
  return (<svg {...svgProps}><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" /><path d="m16 17 5-5-5-5" /><path d="M21 12H9" /></svg>);
}

const FEATURES = [
  { href: "/copy-builder", label: "Copy", Icon: CopyIcon },
  { href: "/dashboard", label: "Dashboard", Icon: DashboardIcon },
  { href: "/planner", label: "Planner", Icon: PlannerIcon },
  { href: "/reports", label: "Reports", Icon: ReportsIcon },
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
    <aside className="w-[72px] shrink-0 border-r border-line bg-surface flex flex-col">
      <div className="px-2 pt-4 pb-4 flex justify-center">
        <div
          className="w-8 h-8 rounded-md bg-ink text-white text-sm font-semibold flex items-center justify-center"
          title="Raycon Tools"
        >
          R
        </div>
      </div>

      <nav className="flex flex-col gap-1 px-2">
        {FEATURES.map(({ href, label, Icon }) => {
          const active = pathname === href || pathname.startsWith(href + "/");
          return (
            <Link
              key={href}
              href={href}
              title={label}
              aria-current={active ? "page" : undefined}
              className={`relative flex flex-col items-center gap-1 rounded-md px-1 py-2.5 transition-colors duration-150 ease-out-soft ${
                active ? "bg-accent-50 text-accent" : "text-ink-secondary hover:bg-chrome hover:text-ink"
              }`}
            >
              {active && <span aria-hidden className="absolute left-0.5 top-1.5 bottom-1.5 w-0.5 rounded-full bg-accent" />}
              <Icon />
              <span className="w-full text-center text-[10px] font-medium leading-tight tracking-tight">{label}</span>
            </Link>
          );
        })}
      </nav>

      <button
        onClick={logout}
        title="Sign out"
        aria-label="Sign out"
        className="mt-auto mx-2 mb-3 flex flex-col items-center gap-1 rounded-md px-1 py-2.5 text-ink-muted hover:bg-chrome hover:text-ink-secondary transition-colors duration-150 ease-out-soft"
      >
        <SignOutIcon />
        <span className="w-full text-center text-[10px] font-medium leading-tight tracking-tight">Sign out</span>
      </button>
    </aside>
  );
}
