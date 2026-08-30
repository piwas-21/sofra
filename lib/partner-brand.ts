// A partner's PUBLIC brand — the pure rules about it (SOFRA-PARTNER-PLAN §11).
//
// Pure by construction: no `db` import, no I/O, nothing that can read a session.
// Everything here is either "is this input acceptable" or "may this record be
// shown", and both have to be answerable — and unit-testable — without a
// database.
//
// The one idea the whole module exists to protect: **a public record and a legal
// record are different records.** `BillingIdentity` holds the name a member state
// registered and the address an invoice is posted to; for a sole trader those are
// a person and their home. This holds what a diner may be shown. Nothing copies
// the first into the second except `prefillFromBillingIdentity`, which carries one
// field and says why.

import { z } from "zod";
import { isAssignedCountryCode } from "@/lib/country-code";

/**
 * An empty form field is ABSENT, not the empty string.
 *
 * A browser posts every text input it renders, so an untouched optional field
 * arrives as `""`. Stored verbatim that would make `tagline: ""` and `tagline:
 * null` two spellings of the same state, and every future reader would have to
 * know both — the one that forgot would render an empty line in a footer.
 */
const blankToUndefined = (value: unknown): unknown =>
  typeof value === "string" && value.trim() === "" ? undefined : value;

const optionalText = (max: number) =>
  z.preprocess(blankToUndefined, z.string().trim().max(max).optional());

/**
 * `https://` and nothing else.
 *
 * This value ends up in an `href` on a page served to the public, so the scheme
 * is the security boundary, not a formatting preference. `javascript:` is script
 * execution in the reader's page; `http:` is a downgrade we would be advertising
 * on someone else's site. A bare host (`example.com`) is refused rather than
 * silently prefixed: guessing a scheme for a partner is exactly how `http` gets
 * published by accident, and the form asks for the full address.
 *
 * `URL` does the parsing, so no regex has to be right about hosts.
 */
function isHttpsUrl(value: string): boolean {
  try {
    return new URL(value).protocol === "https:";
  } catch {
    return false;
  }
}

/**
 * What a partner must supply to record a public brand.
 *
 * `displayName` is the only required field, and deliberately so: it is the only
 * one that has to exist for the record to mean anything, and demanding an address
 * or a phone number would push a partner into typing their private ones back in.
 *
 * `countryCode` is checked for MEMBERSHIP of ISO 3166-1 alpha-2 through the SAME
 * helper the billing schema uses (lib/country-code.ts) — one list, not two. It
 * decides nothing about tax here (it is only ever displayed), but a second,
 * drifting copy of the country list is the kind of thing that later gets consulted
 * by something that does.
 */
export const partnerBrandSchema = z.object({
  displayName: z.string().trim().min(1).max(80),
  tagline: optionalText(120),
  websiteUrl: z.preprocess(
    blankToUndefined,
    z
      .string()
      .trim()
      .max(200)
      .refine(isHttpsUrl, "Use a full address starting with https://")
      .optional(),
  ),
  email: z.preprocess(blankToUndefined, z.string().trim().max(200).email().optional()),
  phone: optionalText(40),
  addressLine1: optionalText(200),
  postalCode: optionalText(20),
  city: optionalText(120),
  countryCode: z.preprocess(
    blankToUndefined,
    z
      .string()
      .trim()
      .toUpperCase()
      .refine(isAssignedCountryCode, "2-letter ISO 3166-1 country code, e.g. CH")
      .optional(),
  ),
  publishToTenants: z.boolean(),
});

export type PartnerBrandInput = z.infer<typeof partnerBrandSchema>;

/** A checkbox is present-or-absent in FormData; anything else is off. Kept beside
 *  the schema so the form and the action cannot disagree about what "on" means. */
export function checkboxOn(value: unknown): boolean {
  return value === "on" || value === "true";
}

/** The subset of a billing identity a prefill may read. Structural rather than the
 *  Prisma type, so the tests need no generated client. */
export type IdentityNames = { legalName: string; tradeName: string | null };

/**
 * The one field that may be carried from the legal record into the public one.
 *
 * `tradeName ?? legalName` and NOTHING ELSE, as a saving of typing on the field
 * that is least likely to be private — a trade name is chosen to be shown. It is
 * still only a DEFAULT in an editable input; the partner sees it before it is
 * stored and can replace it.
 *
 * The address, the registration number and the VAT number are deliberately not
 * here. Copying them would be the exact mistake the two-model split exists to
 * prevent: for a sole trader the billing address is a home address and
 * `legalName` is a natural person, and a prefilled field is one that gets saved
 * without being read. The partner types the rest by hand, knowing it is public,
 * and that act of typing IS the consent.
 *
 * The `legalName` fallback is the one concession, and it is bounded: a partner
 * with no trade name sees their own name in a visible, editable field labelled
 * as the public one, not silently published.
 */
export function prefillFromBillingIdentity(
  identity: IdentityNames | null | undefined,
): { displayName: string } | null {
  const name = identity?.tradeName?.trim() || identity?.legalName?.trim();
  return name ? { displayName: name } : null;
}

/** What is stored. Structural, for the same reason as `IdentityNames`. */
export type StoredBrand = {
  displayName: string;
  tagline: string | null;
  websiteUrl: string | null;
  email: string | null;
  phone: string | null;
  addressLine1: string | null;
  postalCode: string | null;
  city: string | null;
  countryCode: string | null;
  publishToTenants: boolean;
};

/** Exactly the fields a public surface may render. */
export type RenderableBrand = Omit<StoredBrand, "publishToTenants">;

/**
 * The ONLY way an unpublished brand can reach a public surface: it cannot.
 *
 * A single choke point on purpose. The alternative — every future caller
 * remembering to test `publishToTenants` before it renders — is a rule that holds
 * until the first caller that forgets, and the failure is silent: a partner who
 * never opted in appears in a footer and nothing goes red. Here, forgetting means
 * calling this function and getting `null`.
 *
 * It also RE-PROJECTS rather than spreading the row, so a column added to
 * PartnerBrand later (a founder note, an internal flag) is not published by the
 * mere fact of having been added.
 *
 * Nothing consumes this yet — the publishing half is gated on an owner decision.
 * It ships now so that when something does, the gate is already the only door.
 */
export function renderableBrand(brand: StoredBrand | null | undefined): RenderableBrand | null {
  if (!brand?.publishToTenants) return null;
  return {
    displayName: brand.displayName,
    tagline: brand.tagline,
    websiteUrl: brand.websiteUrl,
    email: brand.email,
    phone: brand.phone,
    addressLine1: brand.addressLine1,
    postalCode: brand.postalCode,
    city: brand.city,
    countryCode: brand.countryCode,
  };
}
