// Invoice arithmetic and numbering — the pure half. (SOFRA-BILLING-IDENTITY-PLAN B4.)
//
// Separated from lib/invoicing.ts (which owns the database and the locking) so
// the money maths is unit-testable, because it is the part that is silently
// wrong rather than loudly broken.

import type { TaxTreatment } from "@/lib/tax-treatment";

export type InvoiceTotals = {
  /** Excluding VAT. */
  netCents: number;
  vatCents: number;
  /** What the customer actually paid. */
  grossCents: number;
  rateBps: number;
};

/**
 * Split the amount Mollie charged into net and VAT.
 *
 * **The charged amount is treated as GROSS — VAT-INCLUSIVE — and that is a
 * deliberate, conservative choice worth understanding before changing it.**
 *
 * Nothing in this system has ever added VAT to a subscription: the Mollie
 * subscription is created for the catalogue price and that exact amount is what
 * leaves the customer's account. So for a Dutch customer, €69 charged is €69
 * received in total, and the only honest reading is that it already contains the
 * VAT — €57.02 net + €11.98 VAT. Reading it as net instead would declare €14.49
 * of VAT on money that never arrived, and Sofra would be paying that difference
 * out of its own margin, quietly, every month.
 *
 * The other direction is a PRICING change, not an invoicing one: if the
 * catalogue becomes explicitly ex-VAT, what must change is the amount charged at
 * Mollie. This function stays correct either way, because it always describes
 * money that actually moved.
 *
 * For the 0% treatments (reverse charge, outside scope) net == gross, and no
 * rounding question arises at all.
 */
export function splitGross(grossCents: number, rateBps: number): InvoiceTotals {
  if (rateBps <= 0) {
    return { netCents: grossCents, vatCents: 0, grossCents, rateBps: 0 };
  }
  // Round the NET, then derive VAT by subtraction, so the two always add back to
  // exactly what was charged. Rounding each independently can leave a one-cent
  // discrepancy against the payment, which is the kind of difference that costs
  // an afternoon at year end.
  const netCents = Math.round((grossCents * 10_000) / (10_000 + rateBps));
  return { netCents, vatCents: grossCents - netCents, grossCents, rateBps };
}

/** Zero-padded sequence within a series and year: `SP-2026-0001`. */
export function formatInvoiceNumber(series: string, year: number, seq: number): string {
  return `${series}-${year}-${String(seq).padStart(4, "0")}`;
}

/**
 * May an invoice be issued at all?
 *
 * Every "no" here is a STOP rather than a fallback, and each is recoverable by a
 * human doing something specific — which is why the reason is returned rather
 * than logged and swallowed. An invoice that cannot be made correct must not be
 * made at all: a wrong one has already been sent by the time anybody notices.
 */
export type IssueBlocker =
  /** The company's own registration details are not configured (B0 owner input). */
  | "sellerNotConfigured"
  /** The customer's legal identity is missing or incomplete. */
  | "buyerNotInvoiceable"
  /** The tax treatment is a judgement call — see lib/tax-treatment.ts. */
  | "taxNeedsReview"
  /** Nothing was actually charged. */
  | "nothingToInvoice";

export function issueBlocker(input: {
  sellerConfigured: boolean;
  buyerInvoiceable: boolean;
  treatment: TaxTreatment;
  grossCents: number;
}): IssueBlocker | null {
  if (!input.sellerConfigured) return "sellerNotConfigured";
  if (!input.buyerInvoiceable) return "buyerNotInvoiceable";
  if (input.treatment === "NEEDS_REVIEW") return "taxNeedsReview";
  if (input.grossCents <= 0) return "nothingToInvoice";
  return null;
}
