// Vitest unit suite (DEV-PHASES-PLAN W1). Convention: unit tests live under
// tests/unit/ (fixtures in tests/unit/fixtures/), Playwright E2E under
// tests/e2e/ — nothing colocated with source. No DB, no network: unit tests
// cover pure lib/ modules only (Mollie is LIVE-keyed — never call it here).
import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    // Mirror tsconfig's `"@/*": ["./*"]` path alias.
    alias: { "@": fileURLToPath(new URL(".", import.meta.url)) },
  },
  test: {
    environment: "node",
    include: ["tests/unit/**/*.test.ts"],
  },
});
