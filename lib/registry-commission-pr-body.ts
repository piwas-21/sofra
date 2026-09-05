// The PR body a commission-rate amendment opens with — the pure half of
// `registry-commission-pr.ts`, split out for the reason `provisioning.ts` split
// `provisioning-pr-body.ts` and `provisioning-pr-blocks.ts` out of itself: its
// GitHub-calling sibling cannot be unit-tested (it needs a token and the
// network), so anything left inside it is decided by reading, not by a test.
//
// That is not a hypothetical cost here. This body's crossover sentence said the
// OPPOSITE of the truth — "below that figure `flat` would have cost this tenant
// less", when below the crossover it is `commission` that is cheaper — from the
// day it was written until 2026-09-05, because no test could see it. It is the
// sentence a founder reads immediately before merging a live per-transaction
// rate. Pure by construction: no GitHub API, no env, no secrets.

import {
  COMMISSION_FLOOR_CENTS,
  COMMISSION_MODE_SAVING_CENTS,
  ONLINE_PAYMENTS_PRICE_CENTS,
  crossoverCentsPerMonth,
} from "./payments-pricing";

// Integer cents as a plain major-units string for a MARKDOWN body — not
// `format.ts`'s `eur()`, whose nl-NL output ("€ 9,00") carries a currency symbol
// this text supplies itself and a figure the surrounding sentence explicitly
// says is in the TENANT's currency, not Sofra's EUR.
const majorUnits = (cents: number): string => (cents / 100).toFixed(2);

/**
 * The PR body: tenant, old → new rate, the crossover (so a reviewer sees the
 * commercial consequence, plan §2), and — the fact easiest to miss — that
 * merging changes ENFORCEMENT only. The billing intent already moved the
 * moment the caller wrote `TenantBilling`; this PR is what makes the box agree
 * with it, and only a re-provision (never a `restart`, which re-reads nothing)
 * makes that happen.
 */
export function commissionChangePrBody(slug: string, oldBps: number, newBps: number): string {
  // No second argument: the crossover is driven by what `commission` SAVES on
  // the module, not by its full list price — see COMMISSION_MODE_SAVING_CENTS,
  // which this deliberately defaults to.
  const crossover = crossoverCentsPerMonth(newBps);
  // Read from the constants, never typed as prose: this file deleted its own
  // duplicated catalog lookup for exactly this reason, and a PR body that
  // hardcodes "€9" is the same drift one layer further out — it would keep
  // saying it after the floor moved, while every UI surface had already changed.
  const floor = majorUnits(COMMISSION_FLOOR_CENTS);
  const full = majorUnits(ONLINE_PAYMENTS_PRICE_CENTS);
  const saving = majorUnits(COMMISSION_MODE_SAVING_CENTS);
  return [
    `Updates \`${slug}\`'s per-transaction commission rate in \`tenants/registry.yml\`, proposed by the control plane's \`/admin\` (SOFRA-PAYMENTS-PRICING-MODE-PLAN S2a).`,
    "",
    `- **tenant** \`${slug}\``,
    `- **rate** \`${oldBps}\` bps → \`${newBps}\` bps`,
    crossover !== null
      ? `- **crossover** ~\`${majorUnits(crossover)}\` of monthly online turnover (this tenant's own billing currency, major units) — below that figure \`commission\` costs this tenant LESS than \`flat\`; above it, more. Computed from the €${saving} the module drops by under \`commission\` (€${full} → the €${floor} floor), not from the full €${full}`
      : "- **crossover** none at 0 bps — commission costs nothing no matter the turnover",
    "",
    "### Merging this changes ENFORCEMENT only",
    "",
    "This edits what is sent to Stripe as `application_fee_amount` once the tenant is",
    "next provisioned — merging alone does **not** flip anything live, and a",
    "`docker compose restart` re-reads nothing (the tenant's env is baked at",
    "provisioning). The billing intent (`TenantBilling`) already reflects the new rate;",
    "until the re-provision below runs, the tenant is billed the new rate while still",
    "being enforced at the old one.",
    "",
    "```bash",
    `gh workflow run provision-tenant.yml --repo piwas-21/restaurant-app-deploy -f slug=${slug}`,
    "```",
    "",
    "Idempotent and safe to re-run.",
  ].join("\n");
}
