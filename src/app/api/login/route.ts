import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import {
  AUTH_COOKIE,
  AUTH_MAX_AGE,
  authEnabled,
  credentialsValid,
  makeToken,
} from "@/lib/auth";

export async function POST(request: NextRequest) {
  // Gate disabled → nothing to log into.
  if (!authEnabled) return NextResponse.json({ ok: true });

  let username = "";
  let password = "";
  try {
    const body = await request.json();
    username = String(body?.username ?? "");
    password = String(body?.password ?? "");
  } catch {
    return NextResponse.json(
      { ok: false, error: "Invalid request" },
      { status: 400 }
    );
  }

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
