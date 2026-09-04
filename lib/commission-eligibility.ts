// Whether a tenant's registry entry may be switched to per-transaction
// commission AT ALL (SOFRA-PAYMENTS-PRICING-MODE-PLAN S2b) — the admin form's
// own gate, checked BEFORE a proposal ever reaches `openCommissionChangePr`.
//
// `provision-tenant.sh` refuses a non-zero `payments_commission_bps` unless the
// SAME entry ALSO carries `online-payments` in `modules` AND a `stripe_account`
// (`lib/provisioning-module-pairing.ts`'s pairing rule, one field over) — and it
// refuses BEFORE the database, so a bad proposal here would not yield a tenant
// billed the wrong way, it would yield NO tenant at all on the next
// re-provision. The common case today is that no tenant carries a
// `stripe_account` yet, so this returns `false` for nearly every tenant — that
// is the correct, unsurprising answer, not a defect in this check.
//
// Reuses `missingPairedStripeAccount` for the account half rather than a second
// truthiness check on `stripe_account` — that function already knows a
// whitespace-only account counts as absent, the same way `provision-tenant.sh`'s
// `-z` test does. It answers a different question on its own (an
// ALREADY-inconsistent entry: the module bought with no account), so it is
// combined with an explicit membership check here rather than negated alone —
// a tenant that never bought `online-payments` at all is not "not missing" its
// account, it is simply not eligible, and the two must not collapse into the
// same `true`.
//
// Pure: no DB, no network, no env.

import { missingPairedStripeAccount } from "./tenant-registry";

export type CommissionEligibility =
  | { eligible: true }
  | { eligible: false; reason: "registryUnavailable" | "notPaired" };

/**
 * @param registryReadable False when the registry could not be read at all —
 *   the pairing cannot be checked, so commission stays refused rather than
 *   guessed at (the same fail-quiet direction `effectivePaymentsMode` takes).
 * @param tenant The tenant's registry entry, or `undefined` when this slug has
 *   no entry yet (a billing plan can exist before its tenant is provisioned) —
 *   treated the same as an unreadable registry: there is nothing here to check
 *   a pairing against.
 */
export function commissionEligibility(args: {
  registryReadable: boolean;
  tenant: { modules: string[]; stripe_account?: string } | undefined;
}): CommissionEligibility {
  if (!args.registryReadable || !args.tenant) {
    return { eligible: false, reason: "registryUnavailable" };
  }
  if (!args.tenant.modules.includes("online-payments")) {
    return { eligible: false, reason: "notPaired" };
  }
  if (missingPairedStripeAccount(args.tenant)) {
    return { eligible: false, reason: "notPaired" };
  }
  return { eligible: true };
}
