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
    // Coverage floor (DEV-PHASES-PLAN W2, D9). Scoped to the pure, fully
    // unit-coverable lib/ modules only — modules with network/DB branches
    // (mollie.ts, email.ts's sendEmail, db.ts, actions/*, auth/rbac) are
    // integration/E2E targets, not unit ones, and would need mocks that §7
    // forbids. Every `include`d file is measured whether or not a test touches
    // it (Vitest-4 default), so an untested pure module drops the number and
    // fails the floor — the gate is honest. Raise thresholds as coverage grows.
    coverage: {
      provider: "v8",
      include: [
        "lib/format.ts",
        "lib/rate-limit.ts",
        "lib/validation.ts",
        "lib/tenant-registry.ts",
        "lib/email-templates.ts",
        "lib/retention-policy.ts",
        "lib/seo.ts",
      ],
      reporter: ["text-summary", "text"],
      // Floors sit a few points under the current 100/95/100/100 so a trivial
      // refactor doesn't break the build, but a new untested pure function or
      // uncovered branch does. Ratchet upward as coverage holds.
      thresholds: { statements: 95, branches: 90, functions: 95, lines: 95 },
    },
  },
});
