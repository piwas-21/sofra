// The two emails invoicing sends. (SOFRA-BILLING-IDENTITY-PLAN B11.)
//
// Both return Resend's verdict and every caller must USE it, because today the
// verdict is usually "no": sofra sends from the shared `onboarding@resend.dev`,
// and Resend refuses every recipient except the account owner's own address. The
// only verified domain on the account is `rumirestaurant.ch`, which belongs to a
// tenant and must not carry Sofra's own invoices.
//
// So these are built and wired, and the admin surface reports delivery honestly
// rather than implying an inbox received something. That mirrors the invite-link
// pattern already used at onboarding: always surface the link so the founder can
// hand it over by hand. Unblocking real delivery is EMAIL-IDENTITY-PLAN §0 — a
// Resend plan upgrade plus a verified sofrapiwas.com sending domain — and when it
// lands, these start working with no code change.

import { sendEmail, siteUrl } from "@/lib/email";
import { craftEmail, detailRows } from "@/lib/email-templates";
import { eur } from "@/lib/format";

/**
 * "Here is your invoice."
 *
 * Links to the document rather than attaching it: the invoice lives behind the
 * payer's own session (`/invoices/[id]`), so a forwarded email cannot expose a
 * legal name, address and VAT number to whoever received it.
 */
export async function sendInvoiceIssued(opts: {
  to: string;
  invoiceId: string;
  number: string;
  tenantSlug: string;
  grossCents: number;
  /** The sentence from lib/tax-treatment.ts, when there is one. Printed verbatim
   *  so the email and the invoice cannot disagree about the VAT treatment. */
  taxNote: string | null;
}): Promise<{ sent: boolean }> {
  return sendEmail({
    to: opts.to,
    subject: `Invoice ${opts.number} — SofraPiwas`,
    html: craftEmail({
      kicker: "Billing",
      title: `Invoice ${opts.number}`,
      bodyHtml:
        detailRows([
          ["Invoice", opts.number],
          ["Service", opts.tenantSlug],
          ["Total", eur(opts.grossCents)],
        ]) +
        (opts.taxNote ? `<p style="margin:12px 0 0;">${opts.taxNote}</p>` : ""),
      cta: { label: "View your invoice", url: `${siteUrl()}/invoices/${opts.invoiceId}` },
    }),
  });
}

/**
 * "We took a payment but cannot invoice you yet — please add your details."
 *
 * Sent when a charge settles and no invoice could be raised for want of the
 * customer's own legal details. It is deliberately NOT a provisional invoice:
 * invoices here are immutable and there are no credit notes, so issuing a wrong
 * one and correcting it later is a promise the system cannot keep. Asking first
 * costs the customer one form and keeps the eventual document correct.
 *
 * It links to the payer's own form (B5), so they can supply the details
 * themselves rather than waiting on the founder to type them.
 */
export async function sendBillingDetailsNeeded(opts: {
  to: string;
  tenantSlug: string;
  grossCents: number;
}): Promise<{ sent: boolean }> {
  return sendEmail({
    to: opts.to,
    subject: "We need your billing details to issue your invoice — SofraPiwas",
    html: craftEmail({
      kicker: "Billing",
      title: "Your invoice is waiting on a few details",
      bodyHtml:
        `<p style="margin:0 0 12px;">We received your payment of ${eur(opts.grossCents)} for ` +
        `${opts.tenantSlug}. Thank you.</p>` +
        `<p style="margin:0 0 12px;">To send you a proper invoice we need the company it should ` +
        `be addressed to — the legal name, address and country. It takes a minute, and the ` +
        `invoice is issued as soon as you have saved them.</p>` +
        `<p style="margin:0;">If your company has an EU VAT number, add it too and we will ` +
        `reverse-charge the VAT instead of charging it.</p>`,
      cta: { label: "Add your billing details", url: `${siteUrl()}/dashboard/billing/details` },
    }),
  });
}
