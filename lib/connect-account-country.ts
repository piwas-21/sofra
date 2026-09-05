// Which country a tenant's connected account is created in (ADR-011 amendment,
// slice E3).
//
// This module exists because of a gap nobody planned for: sofra holds a
// restaurant's name, email, city, currency and modules — and NO country. The
// registry has no `country:` key either (`provision-tenant.sh`'s field whitelist
// does not contain one), and neither does `SignupRequest`. But an Express
// account MUST be created in a country, and Stripe fixes that country forever at
// creation — it is refused on update, like the account type and `business_type`.
//
// So the country is DERIVED from the one fact we do hold, the tenant's trading
// currency, and the derivation refuses to guess whenever the answer is not
// unique. EUR is the case that matters: it is spoken by FR, DE, NL, IT, ES, BE
// and AT, and picking one would create a live, uncorrectable account in the
// wrong country for a real restaurant. A refusal costs the founder one hand-edit
// before merging the registry PR (which the PR body spells out); a wrong guess
// costs a Stripe support case and, possibly, a dead account.
//
// This is deliberately narrow rather than clever. The proper fix is to ASK — a
// country on the lead or on the provision form — and it is recorded in
// docs/plans/BACKLOG.md rather than smuggled in here, because it is a form
// change with six locales attached and this slice is already the wide one.

/**
 * Currencies whose country is unambiguous among the countries we onboard
 * (`CONNECT_ONBOARDABLE_COUNTRIES`).
 *
 * CHF is the one that matters today: Switzerland is the first market, RUMI is a
 * CH tenant, and every tenant in the registry trades in CHF or EUR.
 */
const UNAMBIGUOUS: Readonly<Record<string, string>> = {
  CHF: "CH",
  GBP: "GB",
  USD: "US",
  AED: "AE",
};

export type ConnectCountryVerdict =
  | { ok: true; country: string }
  | { ok: false; reason: string };

/**
 * The account country for a tenant trading in this currency, or a refusal that
 * says why — in words a founder reading a PR body can act on.
 *
 * @param currency ISO-4217, as the registry carries it (`currency:`).
 */
export function connectCountryForCurrency(currency: string | undefined): ConnectCountryVerdict {
  const code = (currency ?? "").trim().toUpperCase();
  if (!code) return { ok: false, reason: "this entry records no currency, so no account country can be derived" };
  const country = UNAMBIGUOUS[code];
  if (country) return { ok: true, country };
  if (code === "EUR") {
    return {
      ok: false,
      reason:
        "EUR does not name one country (FR, DE, NL, IT, ES, BE and AT all use it) and Stripe fixes " +
        "an account's country permanently at creation, so this is not a guess worth making",
    };
  }
  return { ok: false, reason: `no Stripe Connect country is mapped to currency ${code}` };
}
