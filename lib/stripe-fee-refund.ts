// "Fee follows the refund" (ADR-011 amendment, consequence 1). Stripe never
// auto-refunds an application fee when a connected account refunds a charge
// — in Stripe's own words the connected account "loses that amount". Sofra
// is the platform, so it is the only party that CAN return it. This module
// is the arithmetic (pure) and the two-call orchestration
// (app/api/webhooks/stripe/route.ts calls only the latter) that does it.
import { db } from "@/lib/db";
import { stripeGet, stripePost } from "@/lib/stripe";

export type StripeCharge = {
  id: string;
  amount: number;
  amount_refunded: number;
  application_fee: string | null;
};

export type StripeApplicationFee = {
  id: string;
  account: string;
  amount: number;
  // `refunded` is true ONLY on a FULL refund — never branch on it. A partial
  // refund leaves it false with a non-zero amount_refunded, which is exactly
  // the case this module exists to handle.
  refunded: boolean;
  amount_refunded: number;
  currency: string;
  charge: string;
};

/**
 * How much of an application fee is still owed back, given the charge's
 * CURRENT refund state.
 *
 * `target = round_half_away_from_zero(feeAmount * chargeAmountRefunded / chargeAmount)`,
 * `due = target - feeAmountRefunded`, clamped to `[0, feeAmount - feeAmountRefunded]`.
 *
 * ROUNDING IS DELIBERATE: half away from zero, so a tie rounds AGAINST Sofra
 * and the restaurant keeps the extra minor unit rather than Sofra keeping it.
 * `Math.round` in JS rounds half UP (toward +Infinity) — for these values,
 * which are never negative, that IS half-away-from-zero. State this
 * explicitly so nobody "fixes" it into banker's rounding later.
 *
 * Naturally idempotent: a webhook redelivery recomputes the same `target`
 * from the same (by-then-updated) charge/fee state and gets `due = 0`.
 */
export function feeRefundAmount(args: {
  chargeAmount: number;
  chargeAmountRefunded: number;
  feeAmount: number;
  feeAmountRefunded: number;
}): number {
  const { chargeAmount, chargeAmountRefunded, feeAmount, feeAmountRefunded } = args;
  if (chargeAmount <= 0) return 0; // never divide by zero
  const target = Math.round((feeAmount * chargeAmountRefunded) / chargeAmount);
  const due = target - feeAmountRefunded;
  return Math.max(0, Math.min(due, feeAmount - feeAmountRefunded));
}

export type FeeRefundResult =
  | { kind: "no-fee" }
  | { kind: "nothing-due" }
  | { kind: "refunded"; amount: number; stripeRefundId: string };

/**
 * Refunds whatever portion of `chargeId`'s application fee is now owed.
 *
 * Two Stripe resources, two different callers of "who this request is to" —
 * getting this pair backwards is the obvious way to build this wrong:
 *  - the CHARGE lives on the CONNECTED ACCOUNT -> needs `Stripe-Account`.
 *  - the APPLICATION FEE belongs to the PLATFORM (it is Sofra's own money,
 *    already transferred off the connected account) -> NO `Stripe-Account`.
 */
export async function refundApplicationFeeForCharge(
  connectedAccountId: string,
  chargeId: string,
): Promise<FeeRefundResult> {
  const charge = await stripeGet<StripeCharge>(`/v1/charges/${chargeId}`, {
    account: connectedAccountId,
  });
  if (!charge.application_fee) return { kind: "no-fee" };

  // PLATFORM lookup — no `account` option.
  const fee = await stripeGet<StripeApplicationFee>(
    `/v1/application_fees/${charge.application_fee}`,
  );

  const due = feeRefundAmount({
    chargeAmount: charge.amount,
    chargeAmountRefunded: charge.amount_refunded,
    feeAmount: fee.amount,
    feeAmountRefunded: fee.amount_refunded,
  });
  if (due === 0) return { kind: "nothing-due" };

  // Keyed on the TARGET, not `due`: two concurrent deliveries that read the
  // fee before either write lands compute the same target from the same
  // stale state, so they share one Idempotency-Key and Stripe hands both the
  // SAME refund back rather than creating two.
  const target = fee.amount_refunded + due;
  const refund = await stripePost<{ id: string; amount: number }>(
    `/v1/application_fees/${fee.id}/refunds`,
    { amount: String(due) },
    { idempotencyKey: `feerefund:${fee.id}:${target}` },
  ); // PLATFORM — no `account` option.

  // Upsert, not create: the race above can hand this function the SAME
  // `refund.id` twice (Stripe dedupes the POST; the local record still needs
  // to dedupe too), and `stripeRefundId` is the unique idempotency anchor.
  await db.stripeFeeRefund.upsert({
    where: { stripeRefundId: refund.id },
    create: {
      stripeRefundId: refund.id,
      applicationFeeId: fee.id,
      connectedAccountId,
      chargeId,
      amount: refund.amount,
      currency: fee.currency,
    },
    update: {},
  });

  return { kind: "refunded", amount: refund.amount, stripeRefundId: refund.id };
}
