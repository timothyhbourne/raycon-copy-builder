import fs from "fs";
import path from "path";

// Single source of truth for reading environment variables.
//
// WHY THIS EXISTS: the local dev host (Claude desktop) sets some system env vars
// to the empty string "", which shadows the real value. So a bare
// `process.env.X` read returns "" and the key looks unset. The fix — implemented
// here exactly once, instead of copy-pasted across anthropic.ts, northbeam.ts,
// klaviyo.ts, and the cron routes — is: read process.env first, and when it is
// missing/blank, fall back to parsing `.env.local`. In production `.env.local`
// is absent, so the try/catch simply relies on process.env.

let cachedEnvFile: string | null | undefined; // undefined = not yet read; null = absent

function envFileContents(): string | null {
  if (cachedEnvFile === undefined) {
    try {
      cachedEnvFile = fs.readFileSync(path.join(process.cwd(), ".env.local"), "utf8");
    } catch {
      cachedEnvFile = null; // .env.local absent (prod) — rely on process.env
    }
  }
  return cachedEnvFile;
}

/**
 * Read an env var: process.env first (trimmed), then `.env.local`. Returns "" when
 * the key is unset in both. Never throws.
 */
export function readEnv(name: string): string {
  const sys = process.env[name];
  if (sys && sys.trim()) return sys.trim();
  const file = envFileContents();
  if (file) {
    const m = file.match(new RegExp(`^${name}=(.+)$`, "m"));
    if (m) return m[1].trim();
  }
  return "";
}

/**
 * Read a required env var, throwing a clear error when it is missing in both
 * process.env and `.env.local`. Use for keys the caller cannot proceed without.
 */
export function requireEnv(name: string): string {
  const v = readEnv(name);
  if (!v) throw new Error(`${name} is not set. Add it to .env.local (dev) or the deployment environment (prod).`);
  return v;
}

/**
 * Whether diagnostic surfaces (the sandbox + *-debug routes) are exposed. These
 * ship to prod but echo raw upstream errors, so they are OFF in production
 * unless explicitly enabled via ENABLE_DEBUG_ROUTES. In dev they are always on.
 */
export function debugRoutesEnabled(): boolean {
  if (process.env.NODE_ENV !== "production") return true;
  return readEnv("ENABLE_DEBUG_ROUTES") !== "";
}
