import fs from "fs";
import path from "path";

// Storage seam shared by the file-backed JSON stores (planner today; metrics and
// the other stores can adopt it next). The store logic in each caller stays
// backend-agnostic — only the adapter touches a backend. Stage 1 adds a KV/Redis
// adapter here and swaps the binding inside getAdapter(); no caller changes.
//
// Keys are POSIX-relative paths under `root`, e.g. "campaign-planner.json" or
// "daily/2026-07-08.json". This mirrors the seam already documented inline in
// lib/metrics/store.ts, promoted to a shared module so one KV implementation can
// back every store.

export interface StorageAdapter {
  read(key: string): string | null; // null when absent / unreadable
  write(key: string, contents: string): void;
  list(dirKey: string): string[]; // immediate entries under a "directory" key
}

// File-backed adapter rooted at an absolute directory. Writes degrade gracefully
// on a read-only filesystem (Vercel serverless: everything outside /tmp is
// read-only) — they log and no-op instead of throwing, so a read-only deploy
// loads (empty) rather than crashing the request. Data is not durable there;
// that is what the KV adapter (Stage 1) is for.
export function fileAdapter(root: string): StorageAdapter {
  return {
    read(key) {
      try {
        return fs.readFileSync(path.join(root, key), "utf8");
      } catch {
        return null; // missing / unreadable
      }
    },
    write(key, contents) {
      try {
        const full = path.join(root, key);
        fs.mkdirSync(path.dirname(full), { recursive: true });
        fs.writeFileSync(full, contents, "utf8");
      } catch (e) {
        console.warn(`[storage] write failed for ${key} (read-only FS?): ${e instanceof Error ? e.message : e}`);
      }
    },
    list(dirKey) {
      try {
        return fs.readdirSync(path.join(root, dirKey));
      } catch {
        return [];
      }
    },
  };
}

// Backend selector. Stage 1 will return a KV-backed adapter when the Vercel KV
// env is configured and fall back to the file adapter locally; for now every
// store is file-backed exactly as before.
export function getAdapter(root: string): StorageAdapter {
  return fileAdapter(root);
}
