// What a tenant's commission actually EARNED, net of what was returned
// (workspace docs/plans/BACKLOG.md, the second commission blocker; ADR-011's
// second recorded consequence, "no commission reporting surface").
//
// Two tables, one join key, no foreign key: `StripeApplicationFee` (money
// earned) and `StripeFeeRefund` (money returned) both carry a bare
// `connectedAccountId`, and the registry maps a tenant's `stripe_account` back
// to a slug at READ time (ADR-007). This module is the arithmetic between the
// rows and the panel.
//
// Pure: no DB, no network, no env, no clock — the window is always passed in,
// same discipline as lib/trial.ts and lib/stripe-signature.ts.

/** One recorded movement — a fee earned, or a fee returned. */
export type FeeMovement = {
  /** Minor units, in `currency`. */
  amount: number;
  currency: string;
  /** Stripe's own clock for this movement. */
  at: Date;
  chargeId: string;
};

export type CurrencyTotal = {
  currency: string;
  earnedMinor: number;
  refundedMinor: number;
  /** NOT clamped at zero. See `commissionEarnings`. */
  netMinor: number;
  feeCount: number;
  refundCount: number;
};

export type CommissionEarnings =
  | { kind: "unavailable"; reason: "registryUnavailable" | "noStripeAccount" }
  | {
      kind: "ready";
      /** One entry per currency present. Never a mixed sum — there is
       *  deliberately no scalar field to add a CHF fee to a EUR one in. */
      totals: readonly CurrencyTotal[];
      /** Refunds in this window whose charge has no earned row in it. Reported,
       *  never netted away. */
      unmatchedRefundCount: number;
    };

/**
 * Groups a tenant's fee movements by currency over a HALF-OPEN window
 * (`at >= from && at < to`).
 *
 * Three properties the type itself enforces, each of them a failure mode:
 *
 * 1. **`totals` is a list, not a scalar.** A connected account can take charges
 *    in more than one currency (the registry's per-tenant `currency` is the
 *    normal case, not a guarantee), and Stripe denominates the fee per CHARGE.
 *    Summing a CHF fee into a EUR one is silent and wrong by the FX rate.
 * 2. **`unavailable` carries a reason and NO numbers.** A caller physically
 *    cannot render `0` from an unreadable registry. This is the fail-quiet
 *    direction `effectivePaymentsMode`, `isPaymentsPending` and
 *    `commissionEligibility` all take: our outage must never be published as a
 *    claim about a tenant's money.
 * 3. **`netMinor` is NOT clamped at zero.** A refund whose fee predates fee
 *    recording produces a negative net, and that is REAL on day one: staging
 *    already holds two `StripeFeeRefund` rows written by the fee-refund runbook
 *    and will hold zero `StripeApplicationFee` rows for them, because that table
 *    did not exist when they were written. Clamping would hide the pre-history
 *    in the one direction that costs money. `unmatchedRefundCount` is what lets
 *    the panel EXPLAIN the negative instead of tidying it away.
 *
 * "Account present, zero rows" is a third state, distinct from both unavailable
 * reasons: `kind: "ready"` with empty `totals` says "we are watching this
 * account and it has collected nothing", which is a fact. "We cannot see this
 * account" is not.
 */
export function commissionEarnings(args: {
  registryReadable: boolean;
  stripeAccount: string | undefined;
  earned: readonly FeeMovement[];
  refunded: readonly FeeMovement[];
  from: Date;
  to: Date;
}): CommissionEarnings {
  if (!args.registryReadable) return { kind: "unavailable", reason: "registryUnavailable" };
  // `.trim()` for the reason `missingPairedStripeAccount` does it: the box tests
  // `-z`, which a whitespace-only value passes, so " " is not an account.
  if (!args.stripeAccount?.trim()) return { kind: "unavailable", reason: "noStripeAccount" };

  const inWindow = (m: FeeMovement) =>
    m.at.getTime() >= args.from.getTime() && m.at.getTime() < args.to.getTime();
  const earned = args.earned.filter(inWindow);
  const refunded = args.refunded.filter(inWindow);

  const totals = new Map<string, CurrencyTotal>();
  const bucket = (currency: string): CurrencyTotal => {
    // Lower-cased on both sides so "CHF" and "chf" can never be two rows. The
    // write path pins the case already; this is what stops that from silently
    // mattering if a row ever arrives from elsewhere.
    const key = currency.toLowerCase();
    const existing = totals.get(key);
    if (existing) return existing;
    const fresh: CurrencyTotal = {
      currency: key,
      earnedMinor: 0,
      refundedMinor: 0,
      netMinor: 0,
      feeCount: 0,
      refundCount: 0,
    };
    totals.set(key, fresh);
    return fresh;
  };

  for (const fee of earned) {
    const t = bucket(fee.currency);
    t.earnedMinor += fee.amount;
    t.feeCount += 1;
  }
  for (const refund of refunded) {
    const t = bucket(refund.currency);
    t.refundedMinor += refund.amount;
    t.refundCount += 1;
  }
  for (const t of totals.values()) t.netMinor = t.earnedMinor - t.refundedMinor;

  const earnedCharges = new Set(earned.map((f) => f.chargeId));
  const unmatchedRefundCount = refunded.filter((r) => !earnedCharges.has(r.chargeId)).length;

  return {
    kind: "ready",
    // Sorted so the panel's row order is a property of the data, not of Map
    // insertion — two tenants with the same currencies read the same way.
    totals: [...totals.values()].sort((a, b) => a.currency.localeCompare(b.currency)),
    unmatchedRefundCount,
  };
}

/**
 * Connected accounts that have recorded fees and that NO registry entry names —
 * real revenue that appears on nobody's per-tenant page.
 *
 * Realistic causes: a tenant onboarded to Stripe before its registry entry was
 * merged, a hand-edited entry, or a database restored across environments.
 *
 * Stripe ids are CASE-SENSITIVE, so unlike `currency` they are compared as-is:
 * `Acct_A` is not `acct_A` and must not be reported as mapped. Whitespace-only
 * registry values are dropped for the `-z` reason above.
 */
export function unmappedFeeAccounts(
  accountsWithFees: readonly string[],
  registryAccounts: readonly (string | undefined)[],
): string[] {
  const known = new Set(registryAccounts.map((a) => a?.trim()).filter((a): a is string => Boolean(a)));
  return [...new Set(accountsWithFees.filter((a) => !known.has(a)))].sort((a, b) => a.localeCompare(b));
}
