import { NextResponse } from "next/server";
import { z, type ZodType } from "zod";

// Shared request-input validation for the API routes. Every mutating handler
// runs its body through parseBody(req, schema) before touching it, so malformed
// or missing fields become a generic 400 instead of a downstream crash or a
// silently mis-typed object. Detail is logged server-side; the client only ever
// sees a generic message (no stack traces, no raw upstream bodies).

// Reject obviously-oversized payloads before parsing (best-effort via the
// Content-Length header). 1 MB is comfortably above any legitimate body here
// (the largest are generated-campaign snapshots).
const MAX_BODY_BYTES = 1_000_000;

// Entity ids come from network input and are used as store keys / interpolated
// into filenames — constrain them to slug characters everywhere (generalises the
// per-store isSafeId guards).
export const safeIdSchema = z.string().min(1).max(200).regex(/^[a-zA-Z0-9_-]+$/, "id must be slug-safe");

export type ParseResult<T> = { data: T; error?: never } | { data?: never; error: NextResponse };

export async function parseBody<T>(req: Request, schema: ZodType<T>): Promise<ParseResult<T>> {
  const len = Number(req.headers.get("content-length") ?? "0");
  if (len > MAX_BODY_BYTES) {
    return { error: NextResponse.json({ error: "Request body too large" }, { status: 413 }) };
  }

  let raw: unknown;
  try {
    raw = await req.json();
  } catch {
    return { error: NextResponse.json({ error: "Invalid JSON body" }, { status: 400 }) };
  }

  const res = schema.safeParse(raw);
  if (!res.success) {
    const detail = res.error.issues
      .map((i) => `${i.path.join(".") || "(root)"}: ${i.message}`)
      .join("; ")
      .slice(0, 300);
    console.warn(`[api] rejected invalid body: ${detail}`);
    return { error: NextResponse.json({ error: "Invalid request body" }, { status: 400 }) };
  }
  return { data: res.data };
}
