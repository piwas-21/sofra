// The receipt a paying customer gets for a settled charge (EMAIL-SPEC-CONTROL-PLANE G2).
//
// Kept out of lib/billing.ts because that file is a grandfathered over-limit file
// (scripts/file-length-baseline.txt) and email prose is exactly what should not be
// growing it — the same split, for the same reason, as lib/billing-notify.ts.
//
// The founder's copy of this event is `notifyFounder`. This is the customer's, and
// it is deliberately a different message: no Mollie id, no tenant internals, no
// provisioning outcome — just what was charged, for what, and where to see it.

import { audit } from "@/lib/audit";
import { db } from "@/lib/db";
import { sendEmail, siteUrl, escapeHtml } from "@/lib/email";
import { craftEmail, detailRows } from "@/lib/email-templates";
import { eur } from "@/lib/format";
import { receiptDecision } from "@/lib/payment-receipt-policy";
import type { MolliePayment } from "@/lib/mollie";

/** Audit action, and the idempotency marker this path keys on. */
const RECEIPT_ACTION = "billing.receipt.sent";

function receiptHtml(opts: {
  restaurantName: string;
  amountCents: number;
  paidAt: Date | null;
  method: string | null;
  recurring: boolean;
}): string {
  const when = (opts.paidAt ?? new Date()).toISOString().slice(0, 10);
  const rows: [string, string][] = [
    ["Amount", eur(opts.amountCents)],
    ["Date", when],
    ["Restaurant", opts.restaurantName],
  ];
  // Only state the method when Mollie told us one — an empty "Paid with" row
  // invites the reader to wonder what was charged.
  if (opts.method) rows.push(["Paid with", opts.method]);

  return `<p style="margin:0 0 12px;">Thanks — we received your ${
    opts.recurring ? "monthly" : "first"
  } payment for ${escapeHtml(opts.restaurantName)}.</p>
${detailRows(rows)}
<p style="margin:12px 0 0;">Your subscription and payment history are in your dashboard.</p>`;
}

/**
 * Best-effort, never-throws. The payment has SETTLED by the time this runs, and a
 * Resend outage must not turn that into a Mollie retry loop — the same rule every
 * other send on this committed path follows (`invoice-blocked.ts`, `notifyFounder`).
 * `sendEmail` swallows a non-2xx into {sent:false}, but a DNS/connect failure
 * rejects, so the catch is load-bearing rather than defensive decoration.
 *
 * Records why it did nothing when it does nothing: "the customer was not thanked"
 * should be answerable from the audit log, not inferred from an absence.
 */
/**
 * WHO gets told about money.
 *
 * NOT `TenantBilling.email` by preference. That column is free text an admin types
 * at onboarding, and nothing constrains it to the payer — on a reseller plan the
 * restaurant is not the customer at all. Sofra bills the PARTNER (ADR-004: the
 * reseller flow leaves `payerUserId` null and derives the payer from
 * `client.partner`), and mailing a restaurant about a charge it did not make would
 * leak our wholesale price into the partner's relationship with their own customer
 * — the exact thing white-label resale sells against.
 *
 * So this resolves the payer explicitly, preferring the address invoices already
 * use (`BillingIdentity.billingEmail`, `lib/invoicing.ts`) so a customer's receipt
 * and their invoice can never arrive at two different addresses.
 */
function payerAddress(billing: {
  email: string;
  billingIdentity: { billingEmail: string } | null;
  client: { partner: { email: string } | null } | null;
  payer: { email: string } | null;
}): string | null {
  return (
    billing.billingIdentity?.billingEmail ??
    billing.client?.partner?.email ??
    billing.payer?.email ??
    // Last resort, and only for a plan with no identity and no payer reference at
    // all — a shape `defineTenantPlan` refuses to create today.
    billing.email ??
    null
  );
}

export async function sendPaymentReceipt(
  billing: {
    tenantSlug: string;
    email: string;
    name: string;
    billingIdentity: { billingEmail: string } | null;
    client: { partner: { email: string } | null } | null;
    payer: { email: string } | null;
  },
  payment: MolliePayment,
  amountCents: number,
): Promise<void> {
  // Mirrors `notifyFounder`'s shape on purpose: the two are called side by side
  // for the same event, and a reader should see one pair, not two conventions.
  const opts = {
    molliePaymentId: payment.id,
    tenantSlug: billing.tenantSlug,
    to: payerAddress(billing),
    restaurantName: billing.name,
    amountCents,
    status: payment.status,
    sequenceType: payment.sequenceType,
    method: payment.method ?? null,
    paidAt: payment.paidAt ? new Date(payment.paidAt) : null,
  };
  // Cheap guard first: skip both queries for the statuses that can never send.
  if (opts.status !== "paid") return;

  const [invoice, sentBefore] = await Promise.all([
    db.invoice.findUnique({
      where: { molliePaymentId: opts.molliePaymentId },
      select: { id: true },
    }),
    db.auditLog.count({
      where: {
        action: RECEIPT_ACTION,
        entityType: "BillingPayment",
        entityId: opts.molliePaymentId,
      },
    }),
  ]);

  const verdict = receiptDecision({
    status: opts.status,
    invoiceIssued: Boolean(invoice),
    alreadySent: sentBefore > 0,
    to: opts.to,
  });

  if (!verdict.send) {
    // `alreadySent` is the expected steady state on a redelivered webhook, so it
    // is not worth an audit row of its own every time Mollie retries.
    if (verdict.reason !== "alreadySent") {
      await audit(null, "billing.receipt.skipped", "BillingPayment", opts.molliePaymentId, {
        tenantSlug: opts.tenantSlug,
        reason: verdict.reason,
      });
    }
    return;
  }

  const { sent } = await sendEmail({
    to: verdict.to,
    subject: `SofraPiwas — payment received (${eur(opts.amountCents)})`,
    html: craftEmail({
      kicker: "Billing",
      title: "Payment received",
      bodyHtml: receiptHtml({
        restaurantName: opts.restaurantName,
        amountCents: opts.amountCents,
        paidAt: opts.paidAt,
        method: opts.method,
        recurring: opts.sequenceType === "recurring",
      }),
      cta: { label: "View your billing", url: `${siteUrl()}/dashboard/billing` },
      footerNote:
        "This is a payment confirmation. A formal invoice is sent separately once your billing details are on file.",
    }),
  }).catch(() => ({ sent: false }));

  // Written even when the send failed: this row is the idempotency marker, and
  // re-thanking on every one of Mollie's retries would be worse than one missed
  // receipt the founder can see in the audit log and re-send by hand.
  await audit(null, RECEIPT_ACTION, "BillingPayment", opts.molliePaymentId, {
    tenantSlug: opts.tenantSlug,
    sent,
  });
}
