// The sentences printed on an invoice about its VAT treatment.
// (SOFRA-BILLING-IDENTITY-PLAN §4.)
//
// Their own module because they are CUSTOMER-FACING TEXT with legal weight, not
// implementation detail of the decision that selects them: they are printed
// verbatim on the document, quoted in the email, and are the part an accountant
// reads first. Split out of lib/tax-treatment.ts when that file outgrew the §4
// limit, and the seam is a real one — the decision changes far more often than
// the wording, and the wording is the half that must not be edited casually.

/**
 * The exact wording for a reverse-charged supply.
 *
 * It says "reverse-charged" and it does NOT say "0%". Writing `BTW 0%` on the
 * line is the classic Dutch error: a zero RATE is a different thing in law from
 * a TRANSFER of liability, and an invoice claiming the former for the latter is
 * wrong even though both show no money. The invoice must also carry both
 * parties' VAT numbers and no VAT amount at all.
 */
export const REVERSE_CHARGE_NOTE =
  "BTW verlegd / VAT reverse-charged — art. 196 Directive 2006/112/EC";

/** Non-EU supply of a service: outside the scope of EU VAT entirely. */
export const OUTSIDE_SCOPE_NOTE =
  "VAT not applicable — service supplied outside the EU (art. 44)";

/**
 * Printed when an EU buyer had no VAT number we could verify.
 *
 * It INVITES the number rather than apologising for the charge, and it points at
 * FUTURE invoices rather than this one — correcting an issued invoice needs a
 * credit note, which is not built, so promising a correction here would be a
 * promise the system cannot keep.
 */
export const EU_NO_VAT_NOTE =
  "Dutch VAT charged: no verified EU VAT number was on file for this account. " +
  "Add a valid VAT number to your billing details and future invoices will be reverse-charged.";
