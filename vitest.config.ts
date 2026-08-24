import { defineConfig } from "vitest/config";
import path from "path";

// Unit tests for the deterministic core (no network, no LLM). Node environment;
// `@/` resolves to src/ to match tsconfig paths.
//
// .tsx is included for SERVER-RENDER smoke tests: the flow canvas is a 600-line
// React Flow component with no other automated coverage, and rendering it through
// react-dom/server catches a broken import, a bad node-type registration or a
// crash in the initial render without needing a browser. It cannot assert on node
// bodies — React Flow only renders those once it can measure them.
export default defineConfig({
  test: {
    environment: "node",
    include: ["src/**/*.test.{ts,tsx}"],
  },
  resolve: {
    alias: { "@": path.resolve(__dirname, "src") },
  },
});
