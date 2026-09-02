// A partner's PUBLIC brand — the WRITE rules about it (SOFRA-PARTNER-PLAN §11).
//
// What may be SHOWN moved to lib/partner-brand-publish.ts when the pair outgrew
// one file's LOC limit (CLAUDE.md §4) and is re-exported at the foot of this
// file, so `@/lib/partner-brand` is still the only import path anyone needs.
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
import { isHttpsUrl } from "@/lib/partner-brand-publish";

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

// The PUBLISH half, re-exported so `@/lib/partner-brand` stays the one import
// path for this feature. It lives in its own file only because the pair outgrew
// the 200-LOC limit (CLAUDE.md §4); `renderableBrand` is still the single door.
export {
  isHttpsUrl,
  isLegalNameEcho,
  renderableBrand,
  type RenderableBrand,
  type StoredBrand,
} from "@/lib/partner-brand-publish";
