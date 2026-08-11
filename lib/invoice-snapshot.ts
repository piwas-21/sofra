// What gets FROZEN onto an invoice. (SOFRA-BILLING-IDENTITY-PLAN B4.)
//
// Its own file because it is a contract rather than a helper: these two shapes
// are what every issued document contains forever, what a DSR erasure request
// would have to reach, and what any later renderer (PDF, Peppol, Factur-X) reads.
// Changing them changes history's shape, so they should be hard to change by
// accident — which is exactly what a one-line spread inside the issuing function
// was not.

import type { SellerIdentity } from "@/lib/seller-identity";

/**
 * What gets frozen onto the document. Never re-joined at render time.
 *
 * **Fields are named one by one, never spread.** A `{ ...identity }` here looks
 * identical and is not: the argument is a variable, so TypeScript's
 * excess-property check does not apply and the whole Prisma row is copied — ids,
 * timestamps, and every VIES column including the consultation reference and the
 * member state's registered name. That matters more here than almost anywhere
 * else in this schema, because an Invoice is deliberately immutable: there is no
 * update path and no delete path, so anything that lands in this JSON is
 * un-erasable. A sole trader's address is personal data (plan G9), and a DSR
 * erasure request would have nowhere to go. It would also contradict the
 * BillingIdentity comment two files over, which explains why the raw VIES
 * response is deliberately NOT stored.
 */
type PartyRow = {
  legalName: string;
  tradeName: string | null;
  addressLine1: string;
  addressLine2: string | null;
  postalCode: string;
  city: string;
  countryCode: string;
  vatNumber: string | null;
  registrationNo: string | null;
};

export function buyerSnapshot(i: PartyRow) {
  return {
    legalName: i.legalName,
    tradeName: i.tradeName,
    addressLine1: i.addressLine1,
    addressLine2: i.addressLine2,
    postalCode: i.postalCode,
    city: i.city,
    countryCode: i.countryCode,
    vatNumber: i.vatNumber,
    registrationNo: i.registrationNo,
  };
}

/** Same rule: `series` is invoice-numbering config, not a fact about the seller,
 *  and has no business being printed onto every document. */
export function sellerSnapshot(s: SellerIdentity) {
  return {
    legalName: s.legalName,
    addressLine1: s.addressLine1,
    addressLine2: s.addressLine2,
    postalCode: s.postalCode,
    city: s.city,
    countryCode: s.countryCode,
    registrationNo: s.registrationNo,
    vatNumber: s.vatNumber,
    iban: s.iban,
  };
}
