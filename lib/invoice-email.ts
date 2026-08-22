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

import { sendEmail, escapeHtml, siteUrl } from "@/lib/email";
import { craftEmail, detailRows } from "@/lib/email-templates";
import { emailTranslator } from "@/lib/email-locale";
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
  /** The language the payer is written to in (`User.locale`). */
  locale: string;
  /** The sentence from lib/tax-treatment.ts, when there is one. Printed verbatim
   *  so the email and the invoice cannot disagree about the VAT treatment. */
  taxNote: string | null;
}): Promise<{ sent: boolean }> {
  const t = await emailTranslator(opts.locale, "emails.invoice");
  return sendEmail({
    to: opts.to,
    subject: t("subject", { number: opts.number }),
    html: craftEmail({
      kicker: t("kicker"),
      title: t("title", { number: opts.number }),
      bodyHtml:
        detailRows([
          [t("rowInvoice"), opts.number],
          [t("rowService"), opts.tenantSlug],
          [t("rowTotal"), eur(opts.grossCents)],
        ]) +
        // The tax note stays in the language the INVOICE carries it in, which is
        // the language it was stored in at issue time (lib/tax-notes.ts). It is a
        // legal sentence that substantiates a reverse charge, the document shows
        // exactly this string, and translating one of the two copies would make
        // the mail and the invoice disagree about the VAT treatment.
        (opts.taxNote ? `<p style="margin:12px 0 0;">${escapeHtml(opts.taxNote)}</p>` : ""),
      cta: { label: t("cta"), url: `${siteUrl()}/invoices/${opts.invoiceId}` },
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
  /** The language the payer is written to in (`User.locale`). */
  locale: string;
}): Promise<{ sent: boolean }> {
  const t = await emailTranslator(opts.locale, "emails.billingDetails");
  // Hoisted for the same reason as the other templates (Sonar S4624).
  const received = t("received", {
    amount: eur(opts.grossCents),
    restaurant: escapeHtml(opts.tenantSlug),
  });
  return sendEmail({
    to: opts.to,
    subject: t("subject"),
    html: craftEmail({
      kicker: t("kicker"),
      title: t("title"),
      bodyHtml:
        `<p style="margin:0 0 12px;">${received}</p>` +
        `<p style="margin:0 0 12px;">${t("ask")}</p>` +
        `<p style="margin:0;">${t("vat")}</p>`,
      cta: { label: t("cta"), url: `${siteUrl()}/dashboard/billing/details` },
    }),
  });
}
