// Sofra's OWN registration details, for the top of an invoice.
// (SOFRA-BILLING-IDENTITY-PLAN B0/B4.)
//
// From the environment rather than the database, because these are properties of
// the company and not of any row — and, more to the point, because they are the
// one thing in this programme that could not be discovered from the code. They
// are owner inputs (plan §8.1), and until they are supplied **no invoice can be
// issued**, on purpose: a placeholder KVK number on a real invoice is worse than
// no invoice, because it looks finished.
//
// Nothing here is a secret — a KVK and a VAT number are public registry data,
// printed on every invoice and required on the website (plan §5 G6). They live in
// env because they differ per environment (staging must never issue a document
// carrying the real company's identity) and because the box .env is where the
// owner can set them without a deploy.

import { checkVatFormat } from "@/lib/vat-number";
import type { EuNoVatFallback } from "@/lib/tax-treatment";

export type SellerIdentity = {
  legalName: string;
  addressLine1: string;
  addressLine2: string | null;
  postalCode: string;
  city: string;
  countryCode: string;
  /** Chamber of Commerce number (KVK in NL). */
  registrationNo: string;
  /** VAT identification number, normalized. Also the VIES requester id. */
  vatNumber: string;
  iban: string | null;
  /** Invoice number prefix, e.g. "SP" -> SP-2026-0001. */
  series: string;
};

/**
 * The address a customer can actually reach a human at.
 *
 * Its OWN function, separate from `sellerIdentity()`, because the imprint has to
 * offer a contact route even when the rest of the identity is not published yet —
 * and because it is the one field three separate obligations run through: the
 * art. 3:15d imprint contact, the GDPR data-subject route, and "ask us for the
 * terms". An address that bounces makes all three dead letters, so it is never
 * hardcoded and never guessed.
 */
export function contactEmail(): string | null {
  return env("SOFRA_LEGAL_EMAIL") || null;
}

const env = (name: string): string => process.env[name]?.trim() ?? "";

/**
 * How to treat an EU buyer whose VAT number we cannot verify.
 *
 * `nlVat` (default) issues the invoice at 21%; `hold` refuses and waits for a
 * human. It lives in env rather than in code because it is a business decision
 * the accountant may want changed without a deploy — and it is read HERE, beside
 * the rest of the company's tax configuration, so there is one place to look.
 *
 * Anything unrecognised falls back to `nlVat` rather than silently holding every
 * invoice: a typo in an env var must not quietly stop the billing of a business.
 */
export function euNoVatFallback(): EuNoVatFallback {
  return env("SOFRA_EU_NO_VAT_FALLBACK").toLowerCase() === "hold" ? "hold" : "nlVat";
}

/** Which required values are missing. Empty array = ready to invoice. */
export function sellerIdentityGaps(): string[] {
  const required = [
    "SOFRA_LEGAL_NAME",
    "SOFRA_LEGAL_ADDRESS",
    "SOFRA_LEGAL_POSTAL",
    "SOFRA_LEGAL_CITY",
    "SOFRA_LEGAL_COUNTRY",
    "SOFRA_KVK",
    "SOFRA_VAT_NUMBER",
    // Required for the same reason as the rest: an imprint with no working
    // contact address satisfies neither art. 3:15d nor a data-subject request.
    "SOFRA_LEGAL_EMAIL",
  ];
  const gaps = required.filter((name) => !env(name));
  // A malformed VAT number is a gap too, not a value: it would be printed on the
  // invoice AND sent to VIES as our requester id, where it makes every customer
  // check answer INVALID_REQUESTER_INFO (see lib/vies.ts).
  if (env("SOFRA_VAT_NUMBER") && !checkVatFormat(env("SOFRA_VAT_NUMBER")).ok) {
    gaps.push("SOFRA_VAT_NUMBER (malformed)");
  }
  return gaps;
}

/**
 * The seller block, or `null` when the owner has not supplied it yet.
 *
 * Null is a normal, expected state today — §8.1 of the plan lists these as owed —
 * and every caller must treat it as "cannot invoice", never as "use a default".
 */
export function sellerIdentity(): SellerIdentity | null {
  if (sellerIdentityGaps().length > 0) return null;
  const vat = checkVatFormat(env("SOFRA_VAT_NUMBER"));
  return {
    legalName: env("SOFRA_LEGAL_NAME"),
    addressLine1: env("SOFRA_LEGAL_ADDRESS"),
    addressLine2: env("SOFRA_LEGAL_ADDRESS_2") || null,
    postalCode: env("SOFRA_LEGAL_POSTAL"),
    city: env("SOFRA_LEGAL_CITY"),
    countryCode: env("SOFRA_LEGAL_COUNTRY").toUpperCase(),
    registrationNo: env("SOFRA_KVK"),
    // Normalized through the same path the VIES requester uses, so the number on
    // the invoice and the number we identify ourselves with cannot differ.
    vatNumber: vat.ok ? vat.country + vat.national : env("SOFRA_VAT_NUMBER"),
    iban: env("SOFRA_IBAN") || null,
    series: env("SOFRA_INVOICE_SERIES") || "SP",
  };
}
