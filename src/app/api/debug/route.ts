import { NextResponse } from "next/server";
export async function GET() {
  const key = process.env.ANTHROPIC_API_KEY;
  return NextResponse.json({ 
    value: key,
    type: typeof key,
    length: key?.length ?? 0,
    ANTHROPIC_BASE_URL: process.env.ANTHROPIC_BASE_URL,
  });
}
