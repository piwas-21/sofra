// May this billing plan be deleted? (SOFRA-BILLING-IDENTITY-PLAN B11.)
//
// Pure, so the rules that decide whether real money or a legal record is at
// stake can be read and tested in one place, apart from the query that feeds
// them. Deleting a plan is the only destructive action in the control plane.
//
// It exists because test plans accumulate: a plan is created before its first
// payment, so an abandoned experiment leaves a row with a subscription and an
// unpaid payment behind it, and there was no way to clear one without hand-run
// SQL against a live billing database.

export type PlanDeletionFacts = {
  /** Invoices issued against this tenant slug. */
  invoiceCount: number;
  /**
   * Payments that are NOT terminally dead — settled or still able to settle.
   *
   * Deliberately wider than `paid`. `BillingPayment.status` stores Mollie's
   * statuses verbatim, and `authorized` is money committed awaiting capture
   * while `pending` and `open` cover the slow methods (bank transfer, SEPA) that
   * settle days after the checkout. All of them become `paid`.
   */
  liveOrSettledPaymentCount: number;
  /** Subscriptions that could still charge: ACTIVE, ACTIVATING or PENDING. */
  liveSubscriptionCount: number;
  /** Whether a Mollie customer was ever created for this plan. */
  hasMollieCustomer: boolean;
};

/**
 * Is this Mollie payment status one that can still become money?
 *
 * The inverse list is the safe one to hardcode: `failed`, `canceled` and
 * `expired` are terminal, and everything else — including a status Mollie adds
 * next year — is treated as able to settle. An allow-list of "live" statuses
 * would silently let an unknown one through, which is the direction that loses
 * a payment.
 */
export const settledOrInFlight = (status: string): boolean =>
  !["failed", "canceled", "expired"].includes(status);

export type PlanDeletionBlocker =
  /** An issued invoice names this tenant. Deleting the plan orphans a legal record. */
  | "hasInvoices"
  /** Real money settled here. The row IS the audit trail. */
  | "hasPaidPayments"
  /** Mollie could still charge this customer. */
  | "hasLiveSubscription";

export type PlanDeletionVerdict =
  | { deletable: true; warnings: PlanDeletionWarning[] }
  | { deletable: false; blocker: PlanDeletionBlocker };

/** Not a refusal — something the founder should know before confirming. */
export type PlanDeletionWarning = "orphanMollieCustomer";

/**
 * Decide whether a plan may be deleted.
 *
 * Three refusals, each protecting something the database itself will not:
 *
 *  • **Invoices.** `Invoice` links to a tenant by the `tenantSlug` STRING, not by
 *    a foreign key — deliberately, because the registry is not a table (ADR-007).
 *    So Postgres will happily delete a plan out from under its own invoices and
 *    leave them addressed to a tenant that no longer exists. Nothing else checks
 *    this; it has to be checked here.
 *  • **Money settled OR still in flight.** `BillingPayment` cascades from the
 *    plan, so deleting one destroys the record of money that moved. Worse for the
 *    in-flight case: after the delete, `recordPayment` looks the plan up by
 *    `mollieCustomerId`, finds nothing and returns SILENTLY with a 200 — so a
 *    bank transfer settling next Tuesday arrives with no payment row, no invoice,
 *    no audit entry and no founder notification. Nothing anywhere would record
 *    that it happened. Hence `authorized`/`pending`/`open` block too.
 *  • **Live subscriptions.** A PENDING or ACTIVE subscription can still be charged
 *    at Mollie. Deleting only the local row would leave a customer being billed by
 *    a system that no longer knows who they are — the worst of the three, because
 *    it keeps taking money and nothing reports it.
 *
 * PENDING counts as live on purpose: it is the state a plan sits in while waiting
 * for its first payment, so an in-flight checkout could still complete.
 */
export function planDeletionVerdict(facts: PlanDeletionFacts): PlanDeletionVerdict {
  if (facts.invoiceCount > 0) return { deletable: false, blocker: "hasInvoices" };
  if (facts.liveOrSettledPaymentCount > 0) {
    return { deletable: false, blocker: "hasPaidPayments" };
  }
  if (facts.liveSubscriptionCount > 0) {
    return { deletable: false, blocker: "hasLiveSubscription" };
  }

  // Deletable — but say what is being left behind. A Mollie customer created for
  // a plan that never charged is harmless (no mandate, no subscription), yet it
  // outlives the row that named it, and an operator should hear that from us
  // rather than find it in the Mollie dashboard later.
  return {
    deletable: true,
    warnings: facts.hasMollieCustomer ? ["orphanMollieCustomer"] : [],
  };
}
