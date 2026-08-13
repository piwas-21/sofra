// Issuing an invoice. (SOFRA-BILLING-IDENTITY-PLAN B4.)
//
// Called from the Mollie webhook's settled-payment path. Two properties matter
// more than anything else here, and both are about not being quietly wrong:
//
//  1. **The number must be gapless and unique.** See `allocateNumber`.
//  2. **This must never throw into the webhook.** A failure to invoice must not
//     turn a successful payment into a Mollie retry loop — same rule as
//     lib/auto-provision.ts. Every refusal is recorded and reported instead.

import { db } from "@/lib/db";
import { audit } from "@/lib/audit";
import { isInvoiceable } from "@/lib/billing-identity";
import { determineTaxTreatment, type BuyerVatStatus } from "@/lib/tax-treatment";
import { formatInvoiceNumber, issueBlocker, splitGross, type IssueBlocker } from "@/lib/invoice-rules";
import { euNoVatFallback, sellerIdentity } from "@/lib/seller-identity";
import { buyerSnapshot, sellerSnapshot } from "@/lib/invoice-snapshot";
import { resolveIdentityForPlan } from "@/lib/identity-upsert";
import { sendInvoiceIssued } from "@/lib/invoice-email";
import { recordBlockedInvoice } from "@/lib/invoice-blocked";
import type { Prisma } from "@/lib/generated/prisma/client";

export type IssueResult =
  | { issued: true; invoiceId: string; number: string }
  | { issued: false; reason: IssueBlocker | "alreadyIssued" | "noPlan" | "error" };

/**
 * Reserve the next number in (series, year).
 *
 * **A transaction-scoped advisory lock, taken BEFORE the read.** This is the
 * same shape as the backend's order-number race (restaurant-app-backend #336),
 * where a read-then-increment with no lock let two concurrent checkouts collide;
 * here the consequence is worse than a 500, because a duplicated or skipped
 * invoice number is a books problem that surfaces at audit rather than at
 * checkout.
 *
 * Three things are load-bearing:
 *  • **Before the read.** The read only sees committed rows, so a lock taken
 *    after it moves the race rather than closing it.
 *  • **Transaction-scoped** (`pg_advisory_xact_lock`, not `pg_advisory_lock`):
 *    released on commit or rollback, so a crashed request cannot wedge the
 *    series until the connection is recycled.
 *  • **MAX(seq) rather than COUNT(*).** Counting is wrong the moment a row is
 *    ever deleted, and it is wrong silently — it re-issues a number already used.
 *
 * The `@@unique([series, year, seq])` constraint is the backstop: if this
 * reasoning is wrong somewhere, the second writer is refused rather than
 * accepted as a duplicate.
 */
async function allocateNumber(
  tx: Prisma.TransactionClient,
  series: string,
  year: number,
): Promise<{ seq: number; number: string }> {
  // Two-int form: a stable key per (series, year). The series is hashed because
  // the lock key must be an integer; a collision between two series would only
  // serialize them against each other, which is harmless.
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${series}), ${year})`;
  const rows = await tx.$queryRaw<{ max: number | null }[]>`
    SELECT MAX("seq")::int AS max FROM "Invoice" WHERE "series" = ${series} AND "year" = ${year}
  `;
  const seq = (rows[0]?.max ?? 0) + 1;
  return { seq, number: formatInvoiceNumber(series, year, seq) };
}

/**
 * Issue the invoice for a settled Mollie payment.
 *
 * Idempotent on `Invoice.molliePaymentId` (unique), because Mollie redelivers.
 * Never throws: every refusal comes back as a reason the founder can act on.
 */
export async function issueInvoiceForPayment(molliePaymentId: string): Promise<IssueResult> {
  try {
    const existing = await db.invoice.findUnique({ where: { molliePaymentId } });
    if (existing) return { issued: false, reason: "alreadyIssued" };

    const payment = await db.billingPayment.findUnique({
      where: { molliePaymentId },
      include: {
        billing: {
          include: { billingIdentity: true, client: { select: { partnerId: true } } },
        },
      },
    });
    if (!payment) return { issued: false, reason: "noPlan" };

    const seller = sellerIdentity();
    // Through the resolver, NOT `billing.billingIdentity`. A reseller's second
    // plan has a null link, so reading it directly refused an invoice for a
    // customer whose identity is fully on file — after the payment gate had
    // already let the charge through on the resolver's answer. The two must
    // agree, or money settles that can never be invoiced and the re-issue
    // button (same code path) can never clear it.
    const buyer = await resolveIdentityForPlan(payment.billing);
    const tax = determineTaxTreatment({
      sellerCountry: seller?.countryCode ?? "",
      buyerCountry: buyer?.countryCode ?? "",
      buyerVatStatus: (buyer?.vatStatus ?? "NONE") as BuyerVatStatus,
      euNoVatFallback: euNoVatFallback(),
    });

    const blocker = issueBlocker({
      sellerConfigured: Boolean(seller),
      buyerInvoiceable: isInvoiceable(buyer),
      treatment: tax.treatment,
      grossCents: payment.amountCents,
    });
    if (blocker || !seller || !buyer || tax.rateBps === null) {
      const reason = blocker ?? "taxNeedsReview";
      await recordBlockedInvoice({
        molliePaymentId,
        reason,
        tenantSlug: payment.billing.tenantSlug,
        payerEmail: payment.billing.email,
        grossCents: payment.amountCents,
      });
      return { issued: false, reason };
    }

    const totals = splitGross(payment.amountCents, tax.rateBps);
    const year = payment.paidAt?.getUTCFullYear() ?? new Date().getUTCFullYear();

    const invoice = await db.$transaction(async (tx) => {
      const { seq, number } = await allocateNumber(tx, seller.series, year);
      return tx.invoice.create({
        data: {
          number,
          series: seller.series,
          year,
          seq,
          issuedAt: payment.paidAt ?? new Date(),
          sellerSnapshot: sellerSnapshot(seller),
          buyerSnapshot: buyerSnapshot(buyer),
          billingIdentityId: buyer.id,
          tenantSlug: payment.billing.tenantSlug,
          currency: payment.currency,
          netCents: totals.netCents,
          vatCents: totals.vatCents,
          grossCents: totals.grossCents,
          vatRateBps: totals.rateBps,
          taxTreatment: tax.treatment,
          taxNote: tax.invoiceNote,
          molliePaymentId,
          lines: {
            create: [
              {
                description: payment.description,
                quantity: 1,
                unitCents: totals.netCents,
                netCents: totals.netCents,
              },
            ],
          },
        },
      });
    });

    // Same best-effort contract: the invoice is committed and numbered, so a
    // failed send must not undo it or reach the webhook. The audit records
    // whether it went, because an unsent invoice needs a human to forward it.
    const emailed = (
      await sendInvoiceIssued({
        to: buyer.billingEmail,
        invoiceId: invoice.id,
        number: invoice.number,
        tenantSlug: payment.billing.tenantSlug,
        grossCents: invoice.grossCents,
        taxNote: invoice.taxNote,
      }).catch(() => ({ sent: false }))
    ).sent;

    await audit(null, "billing.invoice.issued", "Invoice", invoice.id, {
      tenantSlug: payment.billing.tenantSlug,
      number: invoice.number,
      treatment: tax.treatment,
      emailed,
    });
    return { issued: true, invoiceId: invoice.id, number: invoice.number };
  } catch (e) {
    // Includes the unique-constraint backstop losing a race, which is a correct
    // refusal rather than a fault. Nothing here may reach the webhook.
    console.error("invoice issue failed", molliePaymentId, e);
    return { issued: false, reason: "error" };
  }
}
