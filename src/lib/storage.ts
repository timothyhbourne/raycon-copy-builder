import fs from "fs";
import path from "path";
import { Redis } from "@upstash/redis";

// Storage seam shared by the JSON stores (planner today; metrics and the other
// stores can adopt it next). Each caller stays backend-agnostic — only the
// adapter touches a backend. The interface is ASYNC because a network KV can't
// be synchronous; the file adapter simply resolves immediately.
//
// Keys are POSIX-relative paths under a store's root, e.g. "campaign-planner.json"
// or "daily/2026-07-08.json". getAdapter() picks the backend: Upstash Redis when
// its env is configured (durable, multi-instance — the fix for Vercel's
// ephemeral/read-only FS), else the local file adapter.

export interface StorageAdapter {
  read(key: string): Promise<string | null>; // null when absent / unreadable
  write(key: string, contents: string): Promise<void>;
  list(dirKey: string): Promise<string[]>; // immediate leaf names under a "directory" key
}

function msg(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

// File-backed adapter rooted at an absolute directory. Writes degrade gracefully
// on a read-only filesystem (Vercel serverless: everything outside /tmp is
// read-only) — they log and no-op instead of throwing, so a read-only deploy
// without KV loads (empty) rather than crashing. Data is not durable there; that
// is what the Redis adapter is for.
export function fileAdapter(root: string): StorageAdapter {
  return {
    async read(key) {
      try {
        return fs.readFileSync(path.join(root, key), "utf8");
      } catch {
        return null;
      }
    },
    async write(key, contents) {
      try {
        const full = path.join(root, key);
        fs.mkdirSync(path.dirname(full), { recursive: true });
        fs.writeFileSync(full, contents, "utf8");
      } catch (e) {
        console.warn(`[storage] file write failed for ${key} (read-only FS?): ${msg(e)}`);
      }
    },
    async list(dirKey) {
      try {
        return fs.readdirSync(path.join(root, dirKey));
      } catch {
        return [];
      }
    },
  };
}

// Redis-backed adapter (Upstash REST — serverless-friendly, no connection pool).
// Keys are namespaced (`<namespace>:<key>`) so several stores can share one
// database without collision. Values are opaque strings — automaticDeserialization
// is off so the store above owns the JSON shape, exactly like the file adapter.
function redisAdapter(namespace: string): StorageAdapter {
  const redis = Redis.fromEnv({ automaticDeserialization: false });
  const k = (key: string) => `${namespace}:${key}`;
  return {
    async read(key) {
      const v = await redis.get<string>(k(key));
      return v ?? null;
    },
    async write(key, contents) {
      await redis.set(k(key), contents);
    },
    async list(dirKey) {
      // Leaf names under a "directory" prefix. keys() is O(N) over the keyspace
      // but the sets here are tiny (one blob for the planner; ~1 key/day for
      // metrics), so this stays cheap. Revisit with SCAN if a store grows large.
      const prefix = `${namespace}:${dirKey}/`;
      const found = await redis.keys(`${prefix}*`);
      return found.map((full) => full.slice(prefix.length));
    },
  };
}

// Upstash injects these two env vars (via the Vercel Marketplace integration or
// `vercel env pull`). Both present → use Redis; otherwise fall back to files.
const kvConfigured = Boolean(
  process.env.UPSTASH_REDIS_REST_URL && process.env.UPSTASH_REDIS_REST_TOKEN,
);

// Backend selector. `fileRoot` is the on-disk directory for the file adapter;
// `namespace` scopes this store's keys in Redis. Redis instantiation is lazy
// (inside redisAdapter) so importing this module never requires KV env.
export function getAdapter(fileRoot: string, namespace: string): StorageAdapter {
  return kvConfigured ? redisAdapter(namespace) : fileAdapter(fileRoot);
}
