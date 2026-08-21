// EU VAT identification numbers — normalization and offline format checking.
// (SOFRA-BILLING-IDENTITY-PLAN B2.)
//
// This module is a PRE-FILTER, not an authority. VIES is the authority: only it
// can say whether a number is registered and active for intra-EU trade, and only
// its consultation reference is audit evidence (lib/vies.ts). What this buys us:
//
//   • Instant feedback in a form, with no network round trip.
//   • It catches the trap that made a well-formed number read as INVALID during
//     the plan's research — a FRENCH number queried as the bare 9-digit SIREN.
//     VIES answers `INVALID` to that, indistinguishable from a real negative.
//     Rejecting it here, by shape, means we never spend a call to learn it.
//   • VIES throttles hard (the FR node answered MS_MAX_CONCURRENT_REQ on 5 of 8
//     calls while reporting itself Available), so every call not made is a call
//     that cannot be lost to a busy member state.
//
// Deliberately NOT here: a checksum for every country. Two reasons, and both are
// failure modes rather than laziness — see `checksumOk` below.

/** EU member states, by VAT prefix. Greece trades as `EL`, not `GR`.
 *  Exported so the country-code list can be checked AGAINST it: the two are keyed
 *  differently (prefix vs ISO country), and an EU state present here but missing
 *  there would silently turn a priceable customer into a NEEDS_REVIEW. */
export const EU_VAT_PREFIXES = [
  "AT", "BE", "BG", "CY", "CZ", "DE", "DK", "EE", "EL", "ES",
  "FI", "FR", "HR", "HU", "IE", "IT", "LT", "LU", "LV", "MT",
  "NL", "PL", "PT", "RO", "SE", "SI", "SK",
] as const;

export type EuVatPrefix = (typeof EU_VAT_PREFIXES)[number];

/** Per-country shape of the part AFTER the two-letter prefix. Format only. */
const NATIONAL_FORMATS: Record<EuVatPrefix, RegExp> = {
  AT: /^U\d{8}$/,
  BE: /^[01]\d{9}$/,
  BG: /^\d{9,10}$/,
  CY: /^\d{8}[A-Z]$/,
  CZ: /^\d{8,10}$/,
  DE: /^\d{9}$/,
  DK: /^\d{8}$/,
  EE: /^\d{9}$/,
  EL: /^\d{9}$/,
  ES: /^[A-Z0-9]\d{7}[A-Z0-9]$/,
  FI: /^\d{8}$/,
  // Two alphanumeric key characters + the 9-digit SIREN. The key is numeric on
  // older registrations and alphanumeric on newer ones — `checksumOk` only
  // verifies the numeric case, on purpose.
  FR: /^[A-Z0-9]{2}\d{9}$/,
  HR: /^\d{11}$/,
  HU: /^\d{8}$/,
  IE: /^(\d{7}[A-W][A-IW]?|\d[A-Z+*]\d{5}[A-W])$/,
  IT: /^\d{11}$/,
  LT: /^(\d{9}|\d{12})$/,
  LU: /^\d{8}$/,
  LV: /^\d{11}$/,
  MT: /^\d{8}$/,
  NL: /^\d{9}B\d{2}$/,
  PL: /^\d{10}$/,
  PT: /^\d{9}$/,
  RO: /^\d{2,10}$/,
  SE: /^\d{12}$/,
  SI: /^\d{8}$/,
  SK: /^\d{10}$/,
};

/**
 * Strip everything that is presentation rather than identity, and uppercase.
 *
 * People paste VAT numbers with spaces, dots and non-breaking spaces in them
 * ("FR 27 981 106 214"). The stored form is the canonical one: prefix + national
 * part, no separators — because that is the only form VIES, an invoice and an ICP
 * listing agree on, and a stored variant would break equality comparisons later.
 */
export function normalizeVatNumber(raw: string): string {
  return raw.replace(/[\s.\-/ ]/g, "").toUpperCase();
}

export function isEuVatPrefix(code: string): code is EuVatPrefix {
  return (EU_VAT_PREFIXES as readonly string[]).includes(code);
}

/** Country of the number itself, or null when it carries no known EU prefix. */
export function vatCountryOf(normalized: string): EuVatPrefix | null {
  const prefix = normalized.slice(0, 2);
  return isEuVatPrefix(prefix) ? prefix : null;
}

export type VatFormatVerdict =
  | { ok: true; country: EuVatPrefix; national: string }
  | { ok: false; reason: "empty" | "unknownCountry" | "badFormat" | "badChecksum" };

/**
 * French key check. `key = (12 + 3 × (SIREN mod 97)) mod 97`.
 *
 * Applied ONLY when the key is two digits. Newer French registrations carry an
 * alphanumeric key for which this arithmetic does not hold, so running it
 * unconditionally would reject valid numbers — the exact failure this module
 * exists to avoid. An unverifiable key is passed through to VIES, which is the
 * authority anyway.
 */
function frenchKeyOk(national: string): boolean {
  const key = national.slice(0, 2);
  if (!/^\d{2}$/.test(key)) return true; // alphanumeric key — not checkable here
  const siren = Number(national.slice(2));
  return (12 + 3 * (siren % 97)) % 97 === Number(key);
}

/**
 * Checksums, for the countries where one is both defined and SAFE to enforce.
 *
 * Only France today, and the two absences are deliberate:
 *
 *   • **NL is not checked.** The Dutch btw-id for a sole trader has been RANDOM
 *     since 2020 and does not satisfy the historical 11-proof. Enforcing that
 *     check would reject exactly the smallest, newest Dutch customers — valid
 *     numbers, refused by us, with VIES never consulted.
 *   • **The other 25 are not checked.** Their algorithms vary in quality and
 *     several have documented legitimate exceptions. A format pre-filter that
 *     produces false negatives is worse than no pre-filter, because the user is
 *     told their correct number is wrong and has no way to appeal to VIES.
 *
 * The rule this encodes: a pre-filter may only refuse what VIES would certainly
 * refuse too.
 */
function checksumOk(country: EuVatPrefix, national: string): boolean {
  return country === "FR" ? frenchKeyOk(national) : true;
}

/**
 * Offline verdict on a VAT number's shape.
 *
 * `ok: true` means "worth asking VIES about" — never "valid". A number can pass
 * every check here and still be unknown to the member state, which is precisely
 * the trigger case in the plan (§2b): FR27981106214 is arithmetically perfect and
 * VIES does not have it.
 */
export function checkVatFormat(raw: string): VatFormatVerdict {
  const normalized = normalizeVatNumber(raw);
  if (!normalized) return { ok: false, reason: "empty" };

  const country = vatCountryOf(normalized);
  if (!country) return { ok: false, reason: "unknownCountry" };

  const national = normalized.slice(2);
  if (!NATIONAL_FORMATS[country].test(national)) return { ok: false, reason: "badFormat" };
  if (!checksumOk(country, national)) return { ok: false, reason: "badChecksum" };

  return { ok: true, country, national };
}
