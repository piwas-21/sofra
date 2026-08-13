// What to do about an EU buyer whose VAT number we cannot verify.
// (SOFRA-BILLING-IDENTITY-PLAN §4; sofra ADR-013.)
//
// Its own module because it is the one branch of the tax matrix that is a stated
// POLICY rather than a reading of the law: two answers are defensible, so the
// business chooses, and the reasoning behind that choice is longer than the code.

import { EU_NO_VAT_NOTE } from "@/lib/tax-notes";
import {
  NL_STANDARD_RATE_BPS,
  type BuyerVatStatus,
  type EuNoVatFallback,
  type TaxTreatmentResult,
} from "@/lib/tax-treatment";

const needsReview = (reason: string): TaxTreatmentResult => ({
  treatment: "NEEDS_REVIEW",
  rateBps: null,
  reason,
  invoiceNote: null,
  icpReportable: false,
});

export function euUnverifiedTreatment(
  buyer: string,
  status: BuyerVatStatus,
  fallback: EuNoVatFallback,
): TaxTreatmentResult {
  // An EU buyer we cannot substantiate a reverse charge for. Two defensible
  // readings exist — Dutch VAT for a business we cannot verify, or the buyer's
  // own country rate under OSS for a consumer — and which applies is a judgement
  // call, so the answer depends on a stated policy rather than a guess.
  const why: Record<Exclude<BuyerVatStatus, "VALID">, string> = {
    NONE: "no VAT number supplied",
    UNCHECKED: "VAT number never checked against VIES",
    INVALID: "VAT number rejected by VIES",
    UNAVAILABLE: "VIES could not be reached — status unproven",
  };
  const cause = `EU buyer in ${buyer}: ${why[status as Exclude<BuyerVatStatus, "VALID">]}`;

  // UNAVAILABLE is NOT covered by the fallback, whatever the policy says.
  //
  // The other three are settled answers about the number; this one is "we have
  // not finished asking", and it self-clears. It is also the MODAL state rather
  // than an edge — VIES throttled 5 of 8 calls on the French node — so a buyer
  // with a perfectly good number sits here for minutes at a time.
  //
  // Issuing on it would be one-directional and expensive: the invoice is
  // immutable (decision 4) and credit notes are not built, so a recheck that
  // returns VALID an hour later cannot undo a 21% document. Gross is fixed
  // (decision 8), so that 21% comes out of Sofra's own margin — €11.98 of every
  // €69 — while the buyer receives Dutch VAT a foreign business generally cannot
  // reclaim. Waiting costs a delay; issuing costs money that cannot be recovered.
  //
  // It also inverts decision 2, which protects a proven VALID from being
  // overwritten by an outage: leaving the status protected while letting the
  // outage decide the INVOICE protects nothing, since the invoice is the only
  // consequence the status ever has.
  if (status === "UNAVAILABLE") {
    return needsReview(
      `${cause}. Not eligible for the no-VAT fallback: this is an unfinished check, ` +
        "not a missing number — re-check and it will settle on its own.",
    );
  }

  if (fallback === "hold") {
    return needsReview(
      `${cause}. Decide per customer — Dutch VAT if they are a business we cannot ` +
        "verify, or their own country's rate under OSS if a consumer.",
    );
  }

  // `nlVat` — charge Dutch VAT and issue.
  //
  // Conservative toward the tax authority, and it is worth being exact about who
  // pays for that: the charged amount is fixed (decision 8), so the 21% is taken
  // OUT OF the money already received rather than added to it. Sofra remits
  // €11.98 of every €69 from its own margin. What it buys is that the sale can
  // never turn out to have been under-declared — the failure mode that surfaces
  // at audit with interest.
  //
  // The OSS alternative would charge the buyer's own country rate, which for a
  // small supplier under the EU-wide €10,000 cross-border threshold is not
  // required anyway.
  //
  // The trade it accepts, stated plainly because it is real: if the buyer later
  // produces a valid VAT number, this invoice was still charged VAT that a
  // reverse charge would not have. Correcting an ISSUED invoice needs a credit
  // note, which is not built — so `invoiceNote` invites them to supply the
  // number BEFORE the next charge rather than promising a correction of this one.
  return {
    treatment: "NL_STANDARD",
    rateBps: NL_STANDARD_RATE_BPS,
    reason: `${cause} — charged Dutch VAT under the stated fallback`,
    invoiceNote: EU_NO_VAT_NOTE,
    icpReportable: false,
  };
}
