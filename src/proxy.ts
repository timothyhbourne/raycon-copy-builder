import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { AUTH_COOKIE, authEnabled, tokenValid } from "@/lib/auth";

// App-wide auth gate. In this version of Next.js the `middleware` convention is
// renamed to `proxy` (see node_modules/next docs); this file must export a
// function named `proxy`, and it runs on the Node.js runtime.
//
// Unauthenticated page requests are redirected to the custom /login screen;
// API requests get a 401 instead of a redirect.

const PUBLIC_PATHS = new Set(["/login", "/api/login", "/api/logout"]);

// Routes that enforce their OWN auth (a shared secret) so an external caller —
// e.g. the weekly-report cron, which has no app cookie — can reach them. The
// handler is responsible for rejecting bad callers.
const SELF_PROTECTED_PATHS = new Set(["/api/reports/weekly/run", "/api/metrics/sync"]);

export function proxy(request: NextRequest) {
  // No credentials configured → gate disabled (open access for local/dev).
  if (!authEnabled) return NextResponse.next();

  const { pathname } = request.nextUrl;

  // Let self-protected routes through to enforce their own secret.
  if (SELF_PROTECTED_PATHS.has(pathname)) return NextResponse.next();

  const authed = tokenValid(request.cookies.get(AUTH_COOKIE)?.value);

  // Already signed in and hitting the login page → send them into the app.
  if (authed) {
    if (pathname === "/login") {
      const to = request.nextUrl.clone();
      to.pathname = request.nextUrl.searchParams.get("from") || "/";
      to.search = "";
      return NextResponse.redirect(to);
    }
    return NextResponse.next();
  }

  // Not signed in: let the login screen and its endpoints through.
  if (PUBLIC_PATHS.has(pathname)) return NextResponse.next();

  // API calls fail closed with a 401 rather than an HTML redirect.
  if (pathname.startsWith("/api/")) {
    return NextResponse.json(
      { ok: false, error: "Authentication required" },
      { status: 401 }
    );
  }

  // Pages redirect to the login screen, preserving where they were headed.
  const login = request.nextUrl.clone();
  login.pathname = "/login";
  login.search = "";
  login.searchParams.set("from", pathname);
  return NextResponse.redirect(login);
}

export const config = {
  // Run on every route except Next internals and favicon.
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
