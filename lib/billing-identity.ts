// Billing identity — the pure rules about it. (SOFRA-BILLING-IDENTITY-PLAN B1.)
//
// Kept apart from the server action so "is this invoiceable?" and "did the VAT
// status just get worse?" are answerable without a database, and so the two
// decisions that are easy to get wrong are unit-testable.

import { z } from "zod";
import type { BuyerVatStatus } from "@/lib/tax-treatment";

/**
 * What a form must supply to record an identity.
 *
 * Lives HERE rather than with the other schemas in lib/validation.ts, and that is
 * deliberate: it and `isInvoiceable` below independently encode "these fields are
 * required", and split across two files they would eventually disagree — leaving
 * a row that validates on save and then cannot be invoiced, discovered a month
 * later. Same file, same list, one place to change.
 *
 * `countryCode` is the load-bearing field — it decides the entire tax treatment
 * (lib/tax-treatment.ts) — so it is pinned to the ISO-3166-1 alpha-2 shape rather
 * than left as free text. `vatNumber` is optional and NOT format-checked: a Swiss
 * or British customer has a real national number that is simply not an EU VAT id,
 * and refusing to record it would lose true data. Its EU-shape check happens
 * where it matters — before a VIES call, and before a reverse charge.
 */
export const billingIdentitySchema = z.object({
  legalName: z.string().trim().min(1).max(200),
  tradeName: z.string().trim().max(200).optional().or(z.literal("")),
  legalForm: z.string().trim().max(100).optional().or(z.literal("")),
  registrationNo: z.string().trim().max(60).optional().or(z.literal("")),
  addressLine1: z.string().trim().min(1).max(200),
  addressLine2: z.string().trim().max(200).optional().or(z.literal("")),
  postalCode: z.string().trim().min(1).max(20),
  city: z.string().trim().min(1).max(120),
  countryCode: z
    .string()
    .trim()
    .toUpperCase()
    .regex(/^[A-Z]{2}$/, "2-letter ISO country code, e.g. FR"),
  billingEmail: z.string().trim().max(200).email(),
  vatNumber: z.string().trim().max(30).optional().or(z.literal("")),
});

/** The subset of BillingIdentity these rules read. Structural rather than the
 *  Prisma type, so the tests do not need a generated client. */
export type IdentityFacts = {
  legalName: string;
  addressLine1: string;
  postalCode: string;
  city: string;
  countryCode: string;
  billingEmail: string;
};

/**
 * Is there enough here to address an invoice?
 *
 * These five plus a name are the fields an EU invoice must carry about its
 * recipient. A VAT number is deliberately NOT among them: a Swiss tenant and a
 * Dutch consumer are both perfectly invoiceable without one, and requiring it
 * would block exactly the customers whose treatment is already settled.
 */
export function isInvoiceable(identity: IdentityFacts | null | undefined): boolean {
  if (!identity) return false;
  const required = [
    identity.legalName,
    identity.addressLine1,
    identity.postalCode,
    identity.city,
    identity.billingEmail,
  ];
  return required.every((f) => f.trim().length > 0) && /^[A-Z]{2}$/.test(identity.countryCode);
}

/**
 * Which VAT status should be STORED, given what we had and what VIES just said?
 *
 * The one rule that matters: **a temporary outage must never erase a proven
 * VALID.** VIES answers `valid:false` for its own failures, so a re-check run
 * during a member-state outage would otherwise downgrade a customer who was
 * correctly validated last quarter — and, through lib/tax-treatment.ts, silently
 * retract the reverse charge on their next invoice. The evidence (the
 * consultation reference and its date) is what a VALID rests on, and an outage
 * is not evidence that it expired.
 *
 * Everything else takes the new answer, INCLUDING a VALID→INVALID transition:
 * that one IS a member-state verdict, and a customer who deregistered must stop
 * being reverse-charged.
 */
export function nextVatStatus(current: BuyerVatStatus, incoming: BuyerVatStatus): BuyerVatStatus {
  if (incoming === "UNAVAILABLE" && current === "VALID") return "VALID";
  return incoming;
}

/** What is already stored about a VAT number — the NUMBER included, which is the
 *  whole point of `carriedStatusFor`. */
export type StoredVat = { vatNumber: string | null; vatStatus: BuyerVatStatus };

/**
 * Which stored status may be carried into a check of `incomingNumber`?
 *
 * **A status belongs to the number it was proven for.** Without this, the
 * outage-preservation rule above becomes a hole rather than a guard: take a VALID
 * `FR27981106214` with its consultation reference, change the number to something
 * else, and let VIES throttle (measured 5 calls in 8 on the FR node). The rule
 * would keep `VALID` — for a number nobody ever asked about — beside the OLD
 * number's reference as its evidence. That is a 0%-rated reverse-charge invoice
 * and an ICP line for an unverified number.
 *
 * So a changed number starts from `NONE`. Nothing is proven about it because
 * nothing has been asked about it.
 */
export function carriedStatusFor(
  stored: StoredVat | null,
  incomingNumber: string,
): BuyerVatStatus {
  return stored && stored.vatNumber === incomingNumber ? stored.vatStatus : "NONE";
}

/**
 * May the network call be skipped entirely?
 *
 * Only when the number is unchanged AND already settled — a member state's
 * verdict does not change between two saves, and re-asking would make correcting
 * a typo in `city` block for up to 40 seconds on a third-party call that
 * throttles. `force` is the explicit re-check, where asking IS the point; it
 * skips this shortcut but never the number-scoping, because a re-check that
 * pretended the number was different would drop the preservation rule and let an
 * outage downgrade the very VALID it exists to protect.
 */
export function canSkipVatCheck(
  stored: StoredVat | null,
  incomingNumber: string,
  force = false,
): boolean {
  if (force || !stored || stored.vatNumber !== incomingNumber) return false;
  return stored.vatStatus === "VALID" || stored.vatStatus === "INVALID";
}

/**
 * Should the stored evidence be replaced by this check's?
 *
 * Only when the status is actually being taken from the new answer. Paired with
 * `nextVatStatus` so a preserved VALID keeps the reference and date that prove
 * it, rather than being re-stamped with the moment we failed to reach VIES —
 * which would read as "verified today" on an invoice and in an audit.
 */
export function shouldReplaceVatEvidence(
  current: BuyerVatStatus,
  incoming: BuyerVatStatus,
): boolean {
  return nextVatStatus(current, incoming) === incoming;
}
