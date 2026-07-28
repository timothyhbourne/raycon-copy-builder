// Short, slug-safe entity id (e.g. section / draft ids). Backed by the Web
// Crypto API (crypto.randomUUID / getRandomValues) rather than Math.random() so
// ids don't collide under concurrency and aren't predictable — these are entity
// ids, not security tokens, so this is hardening, not a fix. Uses the GLOBAL
// crypto (available in both the browser and Node) rather than importing the node
// "crypto" module: this file is bundled into client components, where "crypto"
// resolves to crypto-browserify (whose randomUUID is undefined). Signature
// unchanged; output stays within [a-zA-Z0-9_-] so every existing isSafeId guard
// still accepts it, and previously-stored ids keep resolving.
export function nanoid(): string {
  const c = globalThis.crypto;
  if (c && typeof c.randomUUID === "function") {
    return c.randomUUID().replace(/-/g, "").slice(0, 16);
  }
  // Fallback for environments without randomUUID: 8 random bytes → 16 hex chars.
  const bytes = new Uint8Array(8);
  c.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}
