// Partner-facing billing display helpers (pure — no DB/Mollie). Shared by the
// dashboard welcome hero and the billing page so both read a plan the same way.
import { BILLING_INTERVALS } from "@/lib/billing";
import { isTrialActive } from "@/lib/trial";

/** Mollie interval grammar ("1 month") → control.plan.interval.* key. */
export const intervalKeyOf = (mollie: string) =>
  Object.entries(BILLING_INTERVALS).find(([, i]) => i.mollie === mollie)?.[0] ?? "month";

type SubLike = { status: string } | undefined;
type PayLike = { sequenceType: string; status: string };

/** The free period as `planState` reads it: the plan's date, and the clock. */
export type TrialWindow = { trialEndsAt: Date | null; now: Date };

/**
 * What the partner should see for a plan:
 *   trial      — payable, but inside its free period → say "free until", show NO
 *                pay button (SOFRA-PARTNER-FLEXIBILITY-PLAN T-b)
 *   pay        — PENDING, no first payment paid yet → show the pay button
 *   processing — first payment paid but not yet ACTIVE (mandate-lag window) or
 *                mid-activation → show "processing", NEVER a second pay button
 *                (that window is the double-charge trap)
 *   active / inactive / none
 */
export type PlanState = "trial" | "pay" | "processing" | "active" | "inactive" | "none";

/**
 * When this subscription is charged NEXT, or null when it cannot be stated.
 *
 * `BillingSubscription.startDate` is NOT the next charge — it is the FIRST recurring
 * charge, written once at activation (`lib/billing.ts` `subscriptionStartDate`, =
 * activation + one interval) and never advanced again: `recordPayment` inserts a
 * `BillingPayment` row for each recurring charge and touches nothing on the
 * subscription. So rendering `startDate` as "next charge on {date}" is correct for
 * exactly one billing period and then prints a date in the past, forever — which is
 * how it read on the partner billing page before O4, and what an owner would otherwise
 * have been shown as the answer to the one billing question they actually ask.
 *
 * Derived rather than fetched: Mollie's subscription resource carries an authoritative
 * `nextPaymentDate`, but reading it means a network call on every dashboard render,
 * and persisting it means a schema change for a display field. Stepping the anchor
 * forward by the interval needs neither and is right whenever charges land on
 * schedule.
 *
 * The caveat, stated rather than hidden: if a charge FAILS, Mollie's own retry
 * schedule diverges from this arithmetic and the date shown is optimistic by up to one
 * retry window. That is strictly better than a frozen past date, and a failed charge
 * shows up in the payment history the owner is now also shown. Month-end anchors also
 * carry the same 1–3 day overflow drift `subscriptionStartDate` already documents
 * (`setUTCMonth` turns Jan 31 into Mar 3), which settles after the first wrap.
 *
 * Returns null for a missing anchor or an interval outside the catalog, so the caller
 * can fall back to a plain "Active." rather than print a guess.
 */
export function nextChargeDate(
  startDate: Date | null,
  mollieInterval: string,
  now: Date,
): Date | null {
  if (!startDate || Number.isNaN(startDate.getTime())) return null;
  const months = Object.values(BILLING_INTERVALS).find((i) => i.mollie === mollieInterval)?.months;
  if (!months) return null;

  // Step from the anchor rather than from `now`, so the answer stays on the
  // subscription's own day-of-month instead of drifting to whenever the page was
  // loaded. Bounded by construction: each iteration advances at least one month, and
  // the loop stops the moment it passes `now`.
  const next = new Date(startDate);
  while (next <= now) {
    next.setUTCMonth(next.getUTCMonth() + months);
  }
  return next;
}

/**
 * Mollie's `sequenceType` → a `control.plan.sequence.*` key.
 *
 * The partner billing page prints the raw value, which is fine for a reseller reading
 * their own book. An OWNER's history is customer-facing, and "recurring"/"oneoff" are
 * our vendor's vocabulary, not theirs.
 */
export function sequenceKey(sequenceType: string): "first" | "recurring" | "oneoff" {
  if (sequenceType === "first") return "first";
  if (sequenceType === "oneoff") return "oneoff";
  return "recurring";
}

/**
 * Mollie's payment `status` → a `control.plan.paymentStatus.*` key.
 *
 * Collapses the seven Mollie statuses into the four distinctions a payer acts on:
 * it went through, it is in flight, it did not go through, or something we do not
 * recognise (kept as a bucket so a status Mollie adds later renders as text rather
 * than a missing-key crash — never silently as "paid").
 */
export function paymentStatusKey(status: string): "paid" | "pending" | "failed" | "other" {
  if (status === "paid" || status === "authorized") return "paid";
  if (status === "open" || status === "pending") return "pending";
  if (status === "failed" || status === "canceled" || status === "expired") return "failed";
  return "other";
}

/**
 * The one verdict every payer-facing surface branches on.
 *
 * `trial` is a mask over `pay` and over NOTHING else, which is the whole of the
 * rule: a free period suppresses the ASK, it does not rewind money. A plan whose
 * first payment has settled is "processing" whatever its trial says (a second
 * button there is the double-charge trap), an ACTIVE plan is charging, and a
 * canceled one is not offered a button either way.
 *
 * The window is a REQUIRED argument rather than an optional one on purpose. Every
 * caller is a view, and an optional trial is a view that forgets it — which shows a
 * pay button to a partner who was told, on the page next door, that they owe nothing
 * yet. Making it required means a new surface cannot be written without answering
 * the question.
 */
export function planState(sub: SubLike, payments: PayLike[], trial: TrialWindow): PlanState {
  if (!sub) return "none";
  if (sub.status === "ACTIVE") return "active";
  const firstPaid = payments.some((p) => p.sequenceType === "first" && p.status === "paid");
  if (sub.status === "PENDING") {
    if (firstPaid) return "processing";
    return isTrialActive(trial.trialEndsAt, trial.now) ? "trial" : "pay";
  }
  if (sub.status === "ACTIVATING") return "processing";
  return "inactive"; // CANCELED / SUSPENDED / COMPLETED
}
