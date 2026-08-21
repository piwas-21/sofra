// Is this two-letter code actually a COUNTRY? (SOFRA-BILLING-IDENTITY-PLAN B1/B3.)
//
// The billing schema pinned `countryCode` to `/^[A-Z]{2}$/` — a SHAPE check, and
// a shape is not a country. The live control plane carried the proof: the one
// reseller identity on it was stored as `SW`, which is not assigned to anything
// (Switzerland is `CH`, Sweden is `SE`), and every surface treated it as a
// perfectly good country for nine days.
//
// It mattered because `countryCode` decides the entire tax treatment. An
// unassigned code is not "in the EU" by any test, so `determineTaxTreatment`
// fell straight through to OUTSIDE_SCOPE and answered **0% with a confident
// reason** — "buyer established outside the EU (SW)". For a Swiss buyer that
// verdict happened to be right, which is the dangerous part: a correct answer
// was hiding wrong data. Mistype an EU country into something unassigned — `SW`
// for `SE`, `UK`... — and the same path issues an immutable 0% invoice to a
// customer who owed 21% or a reverse charge, with no gate anywhere saying so.
//
// So membership is checked, not shape, and an unrecognised code stops rather
// than being interpreted. It is the same rule the module already applies to the
// seller: only NL is modelled, and anything else refuses to guess.
//
// SCOPE, deliberately: ISO 3166-1 alpha-2 ASSIGNED codes only, from the officially
// assigned list. NOT included, each for a reason:
//   * `EL` — Greece's VAT prefix, not its country code (`GR` is). A VAT prefix is
//     not a country and this field is a country; `lib/vat-number.ts` owns prefixes.
//   * `XI` — Northern Ireland's VAT prefix under the Windsor Framework. A business
//     there is established in `GB`; the distinction belongs to the VAT number.
//   * `UK` — the common mistake for `GB`, and exactly the kind of thing that must
//     be refused rather than accepted as a synonym.
//   * User-assigned ranges (`AA`, `QM`–`QZ`, `XA`–`XZ`, `ZZ`) — private use, and
//     accepting them would defeat the point of the list.
//
// This module says nothing about VAT territories: `ES` covers the Canaries, `FR`
// covers the DOM, and both are outside the EU VAT area. `tax-treatment.ts`
// already states that limitation; a country list cannot fix it.

/** ISO 3166-1 alpha-2, officially assigned. Source: ISO 3166-1 (2024). */
const ASSIGNED = new Set<string>([
  "AD", "AE", "AF", "AG", "AI", "AL", "AM", "AO", "AQ", "AR", "AS", "AT", "AU", "AW", "AX", "AZ",
  "BA", "BB", "BD", "BE", "BF", "BG", "BH", "BI", "BJ", "BL", "BM", "BN", "BO", "BQ", "BR", "BS",
  "BT", "BV", "BW", "BY", "BZ",
  "CA", "CC", "CD", "CF", "CG", "CH", "CI", "CK", "CL", "CM", "CN", "CO", "CR", "CU", "CV", "CW",
  "CX", "CY", "CZ",
  "DE", "DJ", "DK", "DM", "DO", "DZ",
  "EC", "EE", "EG", "EH", "ER", "ES", "ET",
  "FI", "FJ", "FK", "FM", "FO", "FR",
  "GA", "GB", "GD", "GE", "GF", "GG", "GH", "GI", "GL", "GM", "GN", "GP", "GQ", "GR", "GS", "GT",
  "GU", "GW", "GY",
  "HK", "HM", "HN", "HR", "HT", "HU",
  "ID", "IE", "IL", "IM", "IN", "IO", "IQ", "IR", "IS", "IT",
  "JE", "JM", "JO", "JP",
  "KE", "KG", "KH", "KI", "KM", "KN", "KP", "KR", "KW", "KY", "KZ",
  "LA", "LB", "LC", "LI", "LK", "LR", "LS", "LT", "LU", "LV", "LY",
  "MA", "MC", "MD", "ME", "MF", "MG", "MH", "MK", "ML", "MM", "MN", "MO", "MP", "MQ", "MR", "MS",
  "MT", "MU", "MV", "MW", "MX", "MY", "MZ",
  "NA", "NC", "NE", "NF", "NG", "NI", "NL", "NO", "NP", "NR", "NU", "NZ",
  "OM",
  "PA", "PE", "PF", "PG", "PH", "PK", "PL", "PM", "PN", "PR", "PS", "PT", "PW", "PY",
  "QA",
  "RE", "RO", "RS", "RU", "RW",
  "SA", "SB", "SC", "SD", "SE", "SG", "SH", "SI", "SJ", "SK", "SL", "SM", "SN", "SO", "SR", "SS",
  "ST", "SV", "SX", "SY", "SZ",
  "TC", "TD", "TF", "TG", "TH", "TJ", "TK", "TL", "TM", "TN", "TO", "TR", "TT", "TV", "TW", "TZ",
  "UA", "UG", "UM", "US", "UY", "UZ",
  "VA", "VC", "VE", "VG", "VI", "VN", "VU",
  "WF", "WS",
  "YE", "YT",
  "ZA", "ZM", "ZW",
]);

/** Uppercased and trimmed, so a form's `ch ` and a snapshot's `CH` compare equal. */
export function normalizeCountryCode(code: string | null | undefined): string {
  return (code ?? "").trim().toUpperCase();
}

/** True only for a code ISO 3166-1 actually assigns to a country or territory. */
export function isAssignedCountryCode(code: string | null | undefined): boolean {
  return ASSIGNED.has(normalizeCountryCode(code));
}

/**
 * Assigned AND already in canonical form — uppercase, no padding.
 *
 * The write schema uppercases, so a stored value that is not canonical did not
 * come through it. `isInvoiceable` uses this rather than the forgiving test: it
 * judges a row that already exists, and "this row went around the schema" is
 * worth stopping on, not worth normalising away at read time.
 */
export function isCanonicalCountryCode(code: string | null | undefined): boolean {
  return typeof code === "string" && code === normalizeCountryCode(code) && ASSIGNED.has(code);
}

/** Count of assigned codes — pins the list against an accidental deletion in a
 *  future edit, which is otherwise a silent narrowing of who may be invoiced. */
export const ASSIGNED_COUNTRY_COUNT = ASSIGNED.size;
