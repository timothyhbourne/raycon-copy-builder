import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import {
  AUTH_COOKIE,
  AUTH_MAX_AGE,
  authEnabled,
  credentialsValid,
  makeToken,
} from "@/lib/auth";
import { parseBody } from "@/lib/validation/api";
import { loginBody } from "@/lib/validation/requests";

export async function POST(request: NextRequest) {
  // Gate disabled → nothing to log into.
  if (!authEnabled) return NextResponse.json({ ok: true });

  const parsed = await parseBody(request, loginBody);
  if (parsed.error) return NextResponse.json({ ok: false, error: "Invalid request" }, { status: 400 });
  const body = parsed.data as { username?: string; password?: string };
  const username = String(body.username ?? "");
  const password = String(body.password ?? "");

  if (!credentialsValid(username, password)) {
    return NextResponse.json(
      { ok: false, error: "Incorrect username or password" },
      { status: 401 }
    );
  }

  const res = NextResponse.json({ ok: true });
  res.cookies.set(AUTH_COOKIE, makeToken(), {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: AUTH_MAX_AGE,
  });
  return res;
}
