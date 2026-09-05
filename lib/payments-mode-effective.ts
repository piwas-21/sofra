// What a tenant's payments mode ACTUALLY is, versus what it is INTENDED to be
// (SOFRA-PAYMENTS-PRICING-MODE-PLAN §3, S2a).
//
// `TenantBilling.paymentsMode`/`.paymentsCommissionBps` (Prisma) is the BILLING
// intent — what a Mollie subscription is computed from. `payments_commission_bps`
// in the deploy repo's `tenants/registry.yml` is the ENFORCEMENT truth — what
// actually reaches the tenant's backend and Stripe. They can disagree, and the
// window is real: this app proposes a registry PR, it never writes to a box
// (ADR-003/007, `lib/registry-commission-pr.ts`), so a mode change is
// `set in Prisma -> registry PR -> merge -> re-provision`, and until the last
// step the tenant is billed one way while enforced the other.
//
// Billing must read the EFFECTIVE mode computed here, never `TenantBilling`'s
// intent directly — reading the intent would bill a tenant for a mode their box
// is not actually running.
//
// This mirrors `lib/payments-pending.ts`'s shape and, in particular, its
// fail-quiet direction: an unreadable registry is OUR ops failure, not the
// tenant's, so it must report the intent with `pending: false` rather than
// invent a claim about a tenant's money from it. Pure: no DB, no network, no env.

import type { PaymentsMode } from "./payments-pricing";

export function effectivePaymentsMode(args: {
  /** `TenantBilling.paymentsMode` — what we intend to bill for. */
  intended: PaymentsMode;
  /**
   * The registry entry's `payments_commission_bps`, or `undefined` when the
   * entry has no such key (or no entry at all) — which means 0, the same
   * convention `lib/registry-commission-edit.ts` uses.
   */
  registryBps: number | undefined;
  /** False when the registry could not be read at all. */
  registryReadable: boolean;
}): { mode: PaymentsMode; pending: boolean } {
  // Fail-quiet: an unreadable registry tells us nothing about enforcement, so
  // the only honest answer is the intent itself, reported as settled — never a
  // manufactured "still switching" claim built from our own outage.
  if (!args.registryReadable) return { mode: args.intended, pending: false };

  const registryMode: PaymentsMode = (args.registryBps ?? 0) > 0 ? "commission" : "flat";
  return { mode: registryMode, pending: registryMode !== args.intended };
}
