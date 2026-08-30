// A partner's PUBLIC brand — the PUBLISH half (SOFRA-PARTNER-PLAN §11e).
//
// Split out of lib/partner-brand.ts when the pair outgrew one file's LOC limit
// (CLAUDE.md §4), along the line the feature already had: that file says what a
// partner may STORE, this one says what may be SHOWN. Both stay pure — no `db`,
// no I/O, nothing that can read a session — and both stay in the coverage floor,
// listed explicitly in vitest.config.ts so the split moved no code out of scope.
//
// `@/lib/partner-brand` re-exports everything here, so it remains the one door
// callers need to know about.

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
export function isHttpsUrl(value: string): boolean {
  try {
    return new URL(value).protocol === "https:";
  } catch {
    return false;
  }
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

/**
 * Exactly what a public surface may render — an ATTRIBUTION, not a contact block
 * (SOFRA-PARTNER-PLAN D-B1): a name and, when there is one, a link — *"Site by
 * <name>"*. The address, phone, email and tagline this used to carry are
 * deliberately GONE. Dropping fields is the self-announcing direction (the
 * assertions naming them go red); widening back to a contact block is the silent
 * one and needs its own controls plus a `pii-inventory.md` row (D-B4) — a sole
 * trader's business email and phone are still personal data.
 *
 * `websiteUrl` is ABSENT rather than null, so this is already the shape the
 * registry generator consumes: a key it does not emit.
 */
export type RenderableBrand = { displayName: string; websiteUrl?: string };

/** trim · case-fold · collapse internal whitespace. Comparison only — nothing
 *  normalised here is ever stored or shown. */
const normalizeName = (value: string): string =>
  value.trim().toLowerCase().replaceAll(/\s+/g, " ");

/**
 * Is this "brand" just the legal name typed again? (D-B1a)
 *
 * NORMALISED, because the trap is a PREFILLED value saved with a stray space or a
 * different case: "  mustafa   VURAL " is the same person as "Mustafa Vural", and
 * an exact-string check would publish them onto a restaurant's public page.
 *
 * Exported so the FORM can say so, in the partner's own language, before they
 * save. One predicate, two readers — a second copy in the UI is the one that
 * drifts, and it drifts towards permissive.
 */
export function isLegalNameEcho(
  displayName: string | null | undefined,
  legalName: string | null | undefined,
): boolean {
  const brand = normalizeName(displayName ?? "");
  return brand.length > 0 && brand === normalizeName(legalName ?? "");
}

/**
 * The ONLY way a brand reaches a public surface — and the only place it is
 * refused. Returns null when: there is no brand · `publishToTenants` is false ·
 * `displayName` is blank · `displayName` IS the legal name. **A missing brand
 * renders NOTHING; it never falls back.**
 *
 * A single choke point on purpose: the alternative — every future caller
 * remembering the flag and the legal-name comparison — holds until the first
 * caller that forgets, and that failure is silent, a name nobody consented to
 * publish sitting in a stranger's footer with nothing going red.
 *
 * It takes the LEGAL name because D-B1a is a rule about the RELATIONSHIP between
 * the two records, so the one function allowed to publish must know both. A named
 * option, not a positional string: a caller that omits it disarms the echo rule
 * visibly, instead of sliding a name into the wrong slot. And it RE-PROJECTS
 * rather than spreading the row, so a column added to `PartnerBrand` later is not
 * published by the mere fact of having been added.
 */
export function renderableBrand(
  brand: StoredBrand | null | undefined,
  opts: { legalName?: string | null } = {},
): RenderableBrand | null {
  if (!brand?.publishToTenants) return null;
  const displayName = brand.displayName.trim();
  if (!displayName) return null;
  if (isLegalNameEcho(displayName, opts.legalName)) return null;
  // Re-checked though the write schema already refuses anything but https:
  // defence in depth on the one field that becomes an `href` on a public page. A
  // row predating the schema, or written by a future admin tool, must not publish
  // a `javascript:` link — and dropping the LINK is the right refusal, since the
  // name is still what the partner asked to show.
  const websiteUrl = brand.websiteUrl?.trim();
  return { displayName, ...(websiteUrl && isHttpsUrl(websiteUrl) ? { websiteUrl } : {}) };
}
