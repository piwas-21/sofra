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
        // Split out of validation.ts (D2) when the pair outgrew the LOC limit. Listed
        // explicitly for the reason provisioning-pr-body.ts is: leaving it off would
        // quietly move already-covered code OUT of the floor's scope, which reads as a
        // passing gate rather than as lost coverage.
        "lib/validation-provision.ts",
        "lib/tenant-registry.ts",
        "lib/onboard-tenants.ts",
        "lib/provision-prefill.ts",
        // The form→entry seam. In scope precisely because its absence is what let a
        // posted field be silently dropped while every other test stayed green.
        "lib/provision-form-input.ts",
        "lib/slug-availability.ts",
        "lib/provisioning-registry.ts",
        // The account-pairing rule, split out of provisioning-registry.ts (S1) for the
        // same LOC-limit reason as provisioning-pr-body.ts below — listed explicitly so
        // splitDeferredModules's branches don't quietly drop out of the floor's scope.
        "lib/provisioning-module-pairing.ts",
        // Split out of provisioning-registry.ts (P1) when the pair outgrew the LOC limit.
        // Listed explicitly because this include list is explicit: leaving it off would
        // have quietly moved already-covered code out of the floor's scope, which reads
        // as a passing gate rather than as lost coverage.
        "lib/provisioning-pr-body.ts",
        // Its conditional sections, split out for the same limit and listed for the
        // same reason. Every branch here is a warning the founder either gets or does
        // not get at the one reviewable moment before a tenant is stood up.
        "lib/provisioning-pr-blocks.ts",
        "lib/module-catalog.ts",
        // S1 — the flat/commission arithmetic (quote adjustment, crossover, the
        // MAX_COMMISSION_BPS ceiling). Pure by construction, same as module-catalog.ts
        // beside it, and the one place the crossover formula every switching surface
        // will quote (S2-S4) is decidable in isolation.
        "lib/payments-pricing.ts",
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
        // B1/B3 — whether a country code names a country. In scope because the
        // branch it adds is the one that decides between "0%, outside the EU" and
        // "stop, we cannot read this", on an invoice that is immutable once issued.
        "lib/country-code.ts",
        "lib/vat-number.ts",
        "lib/vies-result.ts",
        "lib/vies-retry.ts",
        "lib/tax-treatment.ts",
        "lib/billing-identity.ts",
        "lib/invoice-rules.ts",
        "lib/icp.ts",
        "lib/plan-deletion.ts",
        "lib/tax-notes.ts",
        // G15 — what a log line may say about a recipient. In scope because the
        // failure it prevents is silent by construction: a leak here is only ever
        // discovered by reading months of container logs, and the module is pure
        // apart from one env read.
        "lib/log-recipient.ts",
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
        // D1/D1b — whose domain a tenant lives on. BOTH halves of the security boundary
        // are pure and therefore measurable here: what counts as a claimable public zone,
        // and whether a resolver's answer actually proves control of it. The transport
        // (`base-domain-dns.ts`) stays out, same split as vies/vies-result.
        "lib/base-domain.ts",
        // §11 — a partner's PUBLIC brand. In scope because its whole job is a
        // negative: `renderableBrand` is the single door an unpublished record
        // must not get through, and a leak there is silent by construction — it
        // looks like a footer with a name in it. The https-only and ISO-country
        // refusals are decidable here too, and nowhere cheaper.
        "lib/partner-brand.ts",
        // The publish half, split out of it for the LOC limit. Listed explicitly for
        // the reason provisioning-pr-body.ts is: leaving it off would quietly move
        // already-covered code OUT of the floor's scope, which reads as a passing gate
        // rather than as lost coverage — and this is the file holding the refusals.
        "lib/partner-brand-publish.ts",
        "lib/base-domain-verification.ts",
        // D2 — which of the four domain shapes a partner proposed, and what DNS it
        // needs. Pure by construction: it cannot see whose base domain it was handed or
        // whether it is verified, because an authorization decision made in a pure
        // helper is one that can be bypassed by calling the helper differently.
        "lib/client-domain-choice.ts",
        // Tenant backups (ADR-014). All five pure halves of the feature are in
        // scope, and deliberately: this is the surface whose whole job is to say
        // "this restaurant's data is NOT protected", so an untested branch here
        // is one that renders a red condition as calm green text. The DB halves
        // (backup-inventory.ts, backup-jobs.ts) stay out and are E2E targets,
        // the same split as vies/vies-result and fleet's.
        "lib/backup-contract.ts",
        "lib/backup-health.ts",
        "lib/backup-retention.ts",
        "lib/backup-job-policy.ts",
        "lib/backup-overview.ts",
        // D5 — the alarm. In scope for the same reason as the rest of them, only
        // more so: its two failure modes are staying silent while a restaurant is
        // unprotected, and repeating itself until the reader mutes the sender.
        // Both are decidable here, and nowhere else.
        "lib/backup-alert-policy.ts",
        "lib/backup-alert-cadence.ts",
        // One credential per PRINCIPAL. In scope because the branch that matters —
        // "this bearer is real but it is not that box's" — is the difference
        // between a compromised staging box being contained and it being able to
        // erase the control plane's record of the paying tenant's backups.
        "lib/backup-agent-auth.ts",
      ],
      reporter: ["text-summary", "text"],
      // Floors sit a few points under the current 100/95/100/100 so a trivial
      // refactor doesn't break the build, but a new untested pure function or
      // uncovered branch does. Ratchet upward as coverage holds.
      thresholds: { statements: 95, branches: 90, functions: 95, lines: 95 },
    },
  },
});
