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
        "lib/onboard-tenants.ts",
        "lib/provision-prefill.ts",
        "lib/slug-availability.ts",
        "lib/provisioning-registry.ts",
        // Split out of provisioning-registry.ts (P1) when the pair outgrew the LOC limit.
        // Listed explicitly because this include list is explicit: leaving it off would
        // have quietly moved already-covered code out of the floor's scope, which reads
        // as a passing gate rather than as lost coverage.
        "lib/provisioning-pr-body.ts",
        "lib/module-catalog.ts",
        "lib/tenant-options.ts",
        "lib/signup-configuration.ts",
        "lib/checkout-window.ts",
        "lib/email-templates.ts",
        "lib/retention-policy.ts",
        "lib/seo.ts",
        "lib/billing-display.ts",
        // T — the free period. Pure by construction (`now` is always passed in), and
        // the one module where a wrong branch either charges a restaurant that was
        // promised a free month or gives away one that was already paid for.
        "lib/trial.ts",
        "lib/self-serve-signup.ts",
        "lib/provisioning-payment-gate.ts",
        "lib/auto-provision-policy.ts",
        "lib/tenant-liveness.ts",
        // SOFRA-PARTNER-PLAN §9 — what a partner is told about the tenant they sold.
        // Pure: it only judges a registry result and a plan the caller already loaded,
        // and every "say nothing" branch in it is a branch a partner would otherwise
        // meet as an empty panel.
        "lib/client-tenant.ts",
        // O7 P4 — the pre-grant window predicate. Pure, and the registry-unreadable
        // branch is the one that must never regress silently.
        "lib/payments-pending.ts",
        // Billing identity / VAT (SOFRA-BILLING-IDENTITY-PLAN B2+B3). The pure
        // halves only: `lib/vies.ts` owns the fetch and stays out of scope, which
        // is exactly why the judgement it depends on was split into
        // `vies-result.ts` — the part that is easy to get wrong is measurable here.
        "lib/vat-number.ts",
        "lib/vies-result.ts",
        "lib/vies-retry.ts",
        "lib/tax-treatment.ts",
        "lib/billing-identity.ts",
        "lib/invoice-rules.ts",
        "lib/icp.ts",
        "lib/plan-deletion.ts",
        "lib/tax-notes.ts",
        // G16 — the delivery-verdict rule. Its query wrapper (`email-delivery.ts`) stays out, same
        // split as vies/vies-result above.
        "lib/email-delivery-verdicts.ts",
        // T-d — when a free period is warned about, and to whom. Same policy/sweep split
        // as go-live-policy/go-live-notify: the half that decides is total and pure, the
        // half that mails and writes audit rows is not and stays out of scope.
        "lib/trial-warning-policy.ts",
        // Who a bill is addressed to. Lifted out of payment-receipt.ts (T-d) precisely so
        // it could be measured: it decides whether a reseller's RESTAURANT reads a price
        // meant for their partner, and it had no unit coverage while it was private.
        "lib/payer-contact.ts",
        // The first localized mail (T-d). In scope because a mail rendered from a missing
        // catalogue is a customer reading raw message keys, and that is decidable here.
        "lib/email-locale.ts",
      ],
      reporter: ["text-summary", "text"],
      // Floors sit a few points under the current 100/95/100/100 so a trivial
      // refactor doesn't break the build, but a new untested pure function or
      // uncovered branch does. Ratchet upward as coverage holds.
      thresholds: { statements: 95, branches: 90, functions: 95, lines: 95 },
    },
  },
});
