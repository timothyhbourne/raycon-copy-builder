import { defineConfig } from "vitest/config";
import path from "path";

// Unit tests for the deterministic core (no network, no LLM). Node environment;
// `@/` resolves to src/ to match tsconfig paths.
export default defineConfig({
  test: {
    environment: "node",
    include: ["src/**/*.test.ts"],
  },
  resolve: {
    alias: { "@": path.resolve(__dirname, "src") },
  },
});
