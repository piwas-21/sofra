// What happens when a settled charge cannot be invoiced.
// (SOFRA-BILLING-IDENTITY-PLAN B11.)
//
// Split out of lib/invoicing.ts because it stopped being a `return` and became a
// decision: WHO can fix this refusal, and should we ask them?

import { audit } from "@/lib/audit";
import { db } from "@/lib/db";
import { sendBillingDetailsNeeded } from "@/lib/invoice-email";
import type { IssueBlocker } from "@/lib/invoice-rules";

/** Refusals the CUSTOMER can clear by supplying their own details. Everything
 *  else — our missing registration details, a zero charge — is ours to fix, and
 *  mailing a customer about those is asking them to solve our problem. */
const CUSTOMER_FIXABLE = new Set<string>(["buyerNotInvoiceable"]);

export async function recordBlockedInvoice(opts: {
  molliePaymentId: string;
  reason: IssueBlocker | "taxNeedsReview";
  tenantSlug: string;
  payerEmail: string;
  grossCents: number;
}): Promise<void> {
  let notified = false;
  // Ask ONCE. The issued path is idempotent on `Invoice.molliePaymentId`; this
  // path had nothing equivalent, and Mollie redelivers freely — most sharply
  // through the mandate race, where the webhook answers 503 on purpose and
  // retries run "~80s typically but up to ~26h" (lib/billing.ts). Every one of
  // those re-runs this, so without a check the customer is mailed the same
  // request over and over. `reissueInvoiceAction` is documented "safe to press
  // repeatedly", which would otherwise be false for their inbox.
  //
  // The audit row is the marker: it is already written on every block, so it
  // records exactly "we have been here before for this payment".
  const askedBefore =
    (await db.auditLog.count({
      where: {
        action: "billing.invoice.blocked",
        entityType: "BillingPayment",
        entityId: opts.molliePaymentId,
      },
    })) > 0;

  if (CUSTOMER_FIXABLE.has(opts.reason) && !askedBefore) {
    // Best-effort, like every other send on a committed path: the payment has
    // settled and must stay settled. `sendEmail` swallows a non-2xx into
    // {sent:false}, but a DNS/connect failure REJECTS — and letting that escape
    // would turn a successful payment into a Mollie webhook retry.
    notified = (
      await sendBillingDetailsNeeded({
        to: opts.payerEmail,
        tenantSlug: opts.tenantSlug,
        grossCents: opts.grossCents,
      }).catch(() => ({ sent: false }))
    ).sent;
  }

  await audit(null, "billing.invoice.blocked", "BillingPayment", opts.molliePaymentId, {
    tenantSlug: opts.tenantSlug,
    reason: opts.reason,
    // Recorded because it is the difference between "the customer knows" and
    // "someone has to tell them by hand" — and today it is usually the latter,
    // since sofra still sends from Resend's shared sandbox address.
    customerNotified: notified,
  });
}
