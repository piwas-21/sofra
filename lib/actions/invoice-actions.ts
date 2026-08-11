"use server";

// Re-issuing an invoice for a settled payment that produced none.
// (SOFRA-BILLING-IDENTITY-PLAN B4.)
//
// This exists because issuing happens inside the Mollie webhook, which answers
// 200 and is never redelivered. Without a second way in, a charge that was
// blocked at the moment it settled stays blocked FOREVER — and the first cause is
// certain rather than hypothetical: the company's own registration details are an
// open owner input (plan §8.1), so every payment taken before they are set fails
// with `sellerNotConfigured`. Supplying them later fixes nothing on its own.
//
// The alternative — re-POSTing a real `tr_` id to the webhook — is exactly what
// CLAUDE.md §9 forbids against the live key.

import { revalidatePath } from "next/cache";
import { requireAdmin } from "@/lib/rbac";
import { audit } from "@/lib/audit";
import { rateLimit } from "@/lib/rate-limit";
import { issueInvoiceForPayment } from "@/lib/invoicing";

export type ReissueState = { error?: string; ok?: boolean; number?: string };

/**
 * Issue the invoice for one already-settled payment.
 *
 * Safe to press repeatedly: `issueInvoiceForPayment` is idempotent on the unique
 * `molliePaymentId`, and an already-invoiced charge comes back as `alreadyIssued`
 * rather than minting a second document or burning a sequence number.
 *
 * Deliberately does NOT re-fetch from Mollie. The payment is already mirrored
 * locally and the money already moved; going back to the gateway would add a
 * failure mode to a recovery path whose whole job is to work when something else
 * has already gone wrong.
 */
export async function reissueInvoiceAction(
  _prev: ReissueState,
  formData: FormData,
): Promise<ReissueState> {
  const admin = await requireAdmin();
  if (!rateLimit(`reissue-invoice:${admin.id}`, 60, 15 * 60 * 1000)) {
    return { error: "tooManyAttempts" };
  }

  const molliePaymentId = String(formData.get("molliePaymentId") ?? "");
  if (!molliePaymentId) return { error: "invalidInput" };

  const result = await issueInvoiceForPayment(molliePaymentId);
  revalidatePath("/admin/invoices");

  if (result.issued) {
    await audit(admin.id, "billing.invoice.reissued", "Invoice", result.invoiceId, {
      number: result.number,
    });
    return { ok: true, number: result.number };
  }
  // The reason is a message key in control.errors — the founder needs to know
  // WHICH cause is still unfixed, not merely that it failed again.
  return { error: `invoice.${result.reason}` };
}
