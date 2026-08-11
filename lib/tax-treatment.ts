// What VAT applies to a Sofra sale? (SOFRA-BILLING-IDENTITY-PLAN B3, §4.)
//
// Sofra is a NETHERLANDS-registered company selling an ELECTRONICALLY SUPPLIED
// SERVICE (SaaS). That pair fixes the shape of the answer, and this module is the
// single place it is decided — pure, so the accountant can review one function
// and the tests can pin one table.
//
// The rule that surprises people, and the reason `vatStatus` is an input here
// rather than a boolean "is a business": **a valid VAT identification number is
// the switch, not the customer's word.** Reverse charge is only available if we
// hold the number AND can evidence that we checked it (lib/vies.ts stores the
// consultation reference for exactly this).
//
// Where the law is genuinely a judgement call, this returns NEEDS_REVIEW with no
// rate rather than picking one. An invoice that cannot be determined must stop
// and wait for a human — a plausible wrong rate is far more expensive than a
// blocked invoice, because it is only discovered at audit.

import { isEuVatPrefix } from "@/lib/vat-number";

export type TaxTreatment =
  /** Dutch customer: ordinary domestic VAT. */
  | "NL_STANDARD"
  /** EU business with a VIES-valid number: 0%, liability moves to the customer
   *  (art. 44 place of supply + art. 196 reverse charge). ICP-reportable. */
  | "EU_REVERSE_CHARGE"
  /** Customer outside the EU (Switzerland — RUMI): no EU VAT. Not ICP-reportable.
   *  The recipient may owe acquisition tax at home; that is theirs, not ours. */
  | "OUTSIDE_SCOPE"
  /** Determinable only by a human. Never auto-invoiced. */
  | "NEEDS_REVIEW";

/** The stored VAT-check state of the buyer (mirrors Prisma `VatStatus`). */
export type BuyerVatStatus = "NONE" | "UNCHECKED" | "VALID" | "INVALID" | "UNAVAILABLE";

export type TaxTreatmentInput = {
  /** ISO-3166-1 alpha-2, uppercase. Sofra's own country of establishment. */
  sellerCountry: string;
  /** ISO-3166-1 alpha-2, uppercase. Where the buyer is established. */
  buyerCountry: string;
  buyerVatStatus: BuyerVatStatus;
};

export type TaxTreatmentResult = {
  treatment: TaxTreatment;
  /** Basis points; 2100 = 21%. `null` means undetermined — do not issue. */
  rateBps: number | null;
  /** Why, in one line. Founder/operator-facing English, not customer copy. */
  reason: string;
  /** The sentence that must appear on the invoice, or null when a rate is shown
   *  instead. This is printed VERBATIM — see the note on "0%" below. */
  invoiceNote: string | null;
  /** Whether this sale belongs on the quarterly EC Sales List (opgaaf ICP). */
  icpReportable: boolean;
};

/** The Dutch standard rate, in basis points. */
export const NL_STANDARD_RATE_BPS = 2100;

/**
 * The exact wording for a reverse-charged supply.
 *
 * It says "reverse-charged" and it does NOT say "0%". Writing `BTW 0%` on the
 * line is the classic Dutch error: a zero RATE is a different thing in law from a
 * TRANSFER of liability, and an invoice claiming the former for the latter is
 * wrong even though both show no money. The invoice must also carry both parties'
 * VAT numbers and no VAT amount at all.
 */
export const REVERSE_CHARGE_NOTE = "BTW verlegd / VAT reverse-charged — art. 196 Directive 2006/112/EC";

/** Non-EU supply of a service: outside the scope of EU VAT entirely. */
export const OUTSIDE_SCOPE_NOTE = "VAT not applicable — service supplied outside the EU (art. 44)";

const needsReview = (reason: string): TaxTreatmentResult => ({
  treatment: "NEEDS_REVIEW",
  rateBps: null,
  reason,
  invoiceNote: null,
  icpReportable: false,
});

/**
 * Decide the treatment of one sale.
 *
 * Deliberately NOT modelled: OSS rates for EU consumers. Sofra sells to
 * businesses; a genuine EU B2C sale would need the customer's own country rate
 * across 27 jurisdictions, and a hardcoded rate table silently goes stale — a
 * wrong number that still looks authoritative. Those land in NEEDS_REVIEW, which
 * is a visible stop rather than a confident error.
 *
 * Also not modelled: **VAT-territory exclusions inside member states.** A country
 * code alone puts the Canary Islands, Ceuta and Melilla (ES), the French overseas
 * departments (FR), Åland (FI), Büsingen and Heligoland (DE), and Livigno and
 * Campione (IT) inside the EU VAT area when they are outside it — and Monaco (MC)
 * outside when it is treated as France. Each would be a confident answer derived
 * from a code that does not determine it. Left out because no customer is in one
 * and the postal address, not the country, is what would have to be read; revisit
 * before selling into any of them.
 */
export function determineTaxTreatment(input: TaxTreatmentInput): TaxTreatmentResult {
  const seller = input.sellerCountry.toUpperCase();
  const buyer = input.buyerCountry.toUpperCase();

  // Only an NL establishment is modelled. If Sofra's seat ever moves, the whole
  // matrix changes — better to stop than to keep applying Dutch rules silently.
  if (seller !== "NL") {
    return needsReview(`seller country ${seller || "(unset)"} is not modelled — only NL is`);
  }
  if (!/^[A-Z]{2}$/.test(buyer)) {
    return needsReview("buyer country is missing or not a 2-letter ISO code");
  }

  if (buyer === "NL") {
    return {
      treatment: "NL_STANDARD",
      rateBps: NL_STANDARD_RATE_BPS,
      reason: "domestic supply — Dutch VAT applies",
      invoiceNote: null,
      icpReportable: false,
    };
  }

  // Greece's VAT prefix is EL while its country code is GR — the buyer's COUNTRY
  // is what matters here, so both spellings must resolve to "in the EU". Testing
  // the VAT prefix list alone would push every Greek customer to NEEDS_REVIEW.
  const inEu = isEuVatPrefix(buyer) || buyer === "GR";

  if (!inEu) {
    return {
      treatment: "OUTSIDE_SCOPE",
      rateBps: 0,
      reason: `buyer established outside the EU (${buyer}) — no EU VAT`,
      invoiceNote: OUTSIDE_SCOPE_NOTE,
      icpReportable: false,
    };
  }

  if (input.buyerVatStatus === "VALID") {
    return {
      treatment: "EU_REVERSE_CHARGE",
      rateBps: 0,
      reason: `EU business in ${buyer} with a VIES-valid number — liability reverse-charged`,
      invoiceNote: REVERSE_CHARGE_NOTE,
      icpReportable: true,
    };
  }

  // Every remaining EU case is a judgement call the code must not make.
  // UNAVAILABLE is included on purpose — "we could not reach VIES" is not
  // evidence of anything, and substantiating a reverse charge on it is exactly
  // what an audit looks for.
  //
  // The reason names BOTH candidate treatments rather than only the cause,
  // because the two live rows behind this one state need different answers
  // (Dutch VAT for a business we cannot verify; the buyer's own country rate
  // under OSS for a consumer) and a reason that says only "no VAT number
  // supplied" quietly points a reader at the first.
  const why: Record<Exclude<BuyerVatStatus, "VALID">, string> = {
    NONE: "no VAT number supplied",
    UNCHECKED: "VAT number never checked against VIES",
    INVALID: "VAT number rejected by VIES",
    UNAVAILABLE: "VIES could not be reached — status unproven",
  };
  return needsReview(
    `EU buyer in ${buyer}: ${why[input.buyerVatStatus]}. Decide per customer — ` +
      "Dutch VAT if they are a business we cannot verify, or their own country's rate under OSS if a consumer.",
  );
}
