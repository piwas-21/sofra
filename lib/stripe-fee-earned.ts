// Application fees Sofra EARNED (workspace docs/plans/BACKLOG.md, the SECOND
// blocker before any tenant goes on a non-zero payment commission: "nothing
// reports what the commission earned"). The mirror image of
// lib/stripe-fee-refund.ts, which records only fees RETURNED.
//
// Written by the `application_fee.created` branch of
// app/api/webhooks/stripe/route.ts. That event is a PLATFORM event
// (`event.account` is null — measured; see lib/stripe-webhook-secrets.ts for
// the measurement and its control), which is why the branch sits ABOVE the
// route's `!event.account` guard and why the connected account is read from
// the FEE's own `account` field rather than from the event's.
//
// Deliberately NOT handled here: `application_fee.refunded` /
// `application_fee.refund.updated`. The refunded side is already recorded by
// our own write path (lib/stripe-fee-refund.ts) and a second source for the
// same fact is a reconciliation problem, not a feature.
import { db } from "@/lib/db";
import { stripeGet } from "@/lib/stripe";
import type { StripeApplicationFee } from "@/lib/stripe-fee-refund";

/** One row of `StripeApplicationFee`, exactly as the database takes it. */
export type FeeEarnedRow = {
  applicationFeeId: string;
  connectedAccountId: string;
  chargeId: string;
  amount: number;
  currency: string;
  feeCreatedAt: Date;
};

/**
 * The whole Stripe-object -> row mapping. PURE, so both of the conversions that
 * are easy to get wrong are unit-testable with no DB and no network.
 *
 * `fee.account`, NOT the event's `account`: an ApplicationFee is a
 * platform-owned object and its event carries no account at all, but the fee
 * object itself names the connected account it was taken from. This is the
 * single field the whole per-tenant readout joins on.
 */
export function feeEarnedRow(fee: StripeApplicationFee): FeeEarnedRow {
  return {
    applicationFeeId: fee.id,
    connectedAccountId: fee.account,
    chargeId: fee.charge,
    amount: fee.amount,
    // Stripe returns lower case (measured: `"chf"`). Pinned here so a future
    // upper-case value could never split one tenant's CHF total in two.
    currency: fee.currency.toLowerCase(),
    // Stripe's `created` is epoch SECONDS (measured: 1788558359 -> 2026-09-04),
    // the classic off-by-1000. Getting it wrong puts every fee in 1970, which a
    // month-scoped readout renders as an empty period rather than as an error.
    feeCreatedAt: new Date(fee.created * 1000),
  };
}

/**
 * The WRITE, described as data so the idempotency anchor is assertable without
 * a database.
 *
 * `where` is keyed on `applicationFeeId` and on nothing else, because that is
 * the column the migration makes UNIQUE. This carries more weight here than the
 * same pattern does on the refund side: `feeRefundAmount` neutralises a
 * redelivery arithmetically (it recomputes `due = 0` from the already-updated
 * fee), whereas a "record what happened" write has no arithmetic at all. On
 * this table the unique constraint plus this upsert are the ONLY thing between
 * a Stripe redelivery and double-counted revenue.
 *
 * `update` is empty ON PURPOSE: an ApplicationFee's `amount` is immutable in
 * Stripe (a later refund moves `amount_refunded`, never `amount`), so a
 * redelivery has nothing new to say and must not be able to restate the row.
 */
export type FeeEarnedUpsert = {
  where: { applicationFeeId: string };
  create: FeeEarnedRow;
  update: Record<string, never>;
};

export function feeEarnedUpsert(fee: StripeApplicationFee): FeeEarnedUpsert {
  const row = feeEarnedRow(fee);
  return { where: { applicationFeeId: row.applicationFeeId }, create: row, update: {} };
}

export type FeeEarnedResult = { kind: "recorded"; applicationFeeId: string };

/**
 * Records one application fee, taking ONLY its id from the webhook body and
 * re-reading it from Stripe (CLAUDE.md §5.3, fetch-and-verify — the same
 * discipline lib/stripe-fee-refund.ts follows even though the signature is
 * already verified).
 *
 * PLATFORM lookup, no `Stripe-Account` header: the fee is Sofra's own money,
 * already transferred off the connected account. Sending the header here is the
 * obvious way to build this wrong and yields a 404 for a fee that plainly exists.
 *
 * A fee whose connected account no registry entry names is recorded anyway. The
 * money was earned whether or not we can name the tenant yet, and the join back
 * to a slug happens at READ time (ADR-007) — `lib/commission-earnings.ts`
 * reports such accounts rather than dropping them.
 *
 * The return is a single-member union rather than "recorded | already-known":
 * Prisma's upsert does not report which branch ran, so the second value could
 * not be produced honestly without paying for an extra read that no caller wants.
 */
export async function recordApplicationFee(applicationFeeId: string): Promise<FeeEarnedResult> {
  const fee = await stripeGet<StripeApplicationFee>(`/v1/application_fees/${applicationFeeId}`);
  const write = feeEarnedUpsert(fee);
  await db.stripeApplicationFee.upsert(write);
  return { kind: "recorded", applicationFeeId: write.where.applicationFeeId };
}
