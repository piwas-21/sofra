// What we send Stripe to MINT a tenant's Express connected account, decided
// without calling anything (ADR-011 amendment, slice E2).
//
// Split from the module that performs the call (lib/stripe-connect-accounts.ts)
// for the reason vies-result.ts is split from vies.ts: the part that is easy to
// get wrong here is the PAYLOAD, and a payload is decidable by a unit test while
// a network call is not. Three of its decisions are load-bearing enough that
// each has a measurement behind it.
//
// MEASURED 2026-09-05, Stripe TEST mode, platform acct_1TpwTNCAHTt6eZ8i. Every
// account created was deleted afterwards (GET -> 403).
//
//  1. **The three capabilities go in ONE create call.** `card_payments`,
//     `transfers` and `twint_payments` requested together -> 200 with all three
//     `inactive` (i.e. requested and pending onboarding). The runbook already
//     records why this is not a preference: omitting them fails QUIETLY (§2b.1),
//     and `card_payments` is refused without `transfers`. Asking on a non-CH
//     account is harmless — an FR Express account took `twint_payments` and
//     reported it `inactive` / `requirements.fields_needed`, NOT a refusal — so
//     the list does not need to be country-conditional, and a conditional list
//     is one more thing that can silently omit a capability.
//  2. **Prefill is create-only.** The same fields are refused on UPDATE with
//     `403 oauth_not_supported`, so this call is the only chance. A bare CH
//     Express account has 16 `currently_due`; with business_profile + email +
//     IBAN and no business type it has 13; with `business_type=individual` plus
//     the person's name and address it has 6 (dob x3, phone, tos.date, tos.ip).
//  3. **An address is not a neutral prefill.** `individual[...]` without
//     `business_type` is a hard `400 "The business_type must be provided when
//     sending either of individual or company parameters"`, and `business_type`
//     is one of the fields UPDATE refuses. So the address lives NESTED under
//     `individual` here rather than as a free-standing field: passing it is a
//     commitment that the account holder is a natural person, and a restaurant
//     that turns out to be a company cannot be corrected through the API.

/**
 * The countries this platform will mint a connected account for, mapped to the
 * currency an external bank account in that country is denominated in.
 *
 * The list is exactly the one `docs/runbooks/signup-to-live-tenant.md` §2b.1
 * already offered the founder, one account type over. It is an ALLOWLIST rather
 * than a "not TR" denylist on purpose: a country we have not thought about
 * announces itself as a refusal a founder can read, whereas a denylist admits it
 * silently and discovers the problem at Stripe, or later at the restaurant.
 *
 * MEASURED: Stripe refuses TR itself — `400 country_unsupported "TR is not
 * currently supported by Stripe"`. That is the backstop, not the gate: we refuse
 * BEFORE the call so the message names the tenant and no half-built account can
 * exist.
 */
export const CONNECT_ONBOARDABLE_COUNTRIES: Readonly<Record<string, string>> = {
  CH: "chf",
  FR: "eur",
  DE: "eur",
  NL: "eur",
  IT: "eur",
  ES: "eur",
  BE: "eur",
  AT: "eur",
  GB: "gbp",
  US: "usd",
  AE: "aed",
};

/** Countries in the list above whose bank accounts are NOT identified by an IBAN. */
const NON_IBAN_COUNTRIES: readonly string[] = ["US"];

/** Eating places / restaurants. Every tenant of this platform is one. */
export const RESTAURANT_MCC = "5812";

export class UnsupportedConnectCountryError extends Error {
  readonly country: string;
  constructor(country: string) {
    super(
      `Stripe Connect onboarding is not offered for country ${JSON.stringify(country)} — ` +
        `supported: ${Object.keys(CONNECT_ONBOARDABLE_COUNTRIES).join(", ")}. ` +
        `TR in particular is refused by Stripe itself (country_unsupported).`,
    );
    this.country = country;
  }
}

export type ConnectPostalAddress = {
  line1: string;
  city: string;
  postalCode: string;
};

export type ExpressAccountInput = {
  /** Registry slug — the metadata tag and the idempotency-key seed. */
  slug: string;
  /** ISO-3166-1 alpha-2, upper case. Fixed at Stripe forever after this call. */
  country: string;
  /** The RESTAURANT's own address, never a Sofra one: Stripe mails it. */
  email: string;
  /** The restaurant's trading name -> `business_profile[name]`. */
  name: string;
  /** The tenant's public URL -> `business_profile[url]`. */
  url: string;
  /**
   * The natural person who owns the account. Nested rather than flat because
   * sending ANY `individual[...]` field commits `business_type=individual`
   * (measured: a 400 otherwise), and `business_type` is refused on update
   * (403 `oauth_not_supported`). So this is a claim, not a hint.
   */
  individual?: {
    firstName?: string;
    lastName?: string;
    address?: ConnectPostalAddress;
  };
  /** The restaurant's IBAN, when we hold one -> `external_account`. */
  iban?: string;
};

/**
 * Build the `POST /v1/accounts` form. Pure: no clock, no network, no env.
 *
 * Everything optional is OMITTED when absent rather than sent empty — Stripe
 * treats an empty string as a value, and a blank `business_profile[url]` is a
 * field the restaurant then has to clear by hand in the hosted flow.
 *
 * @throws UnsupportedConnectCountryError for a country we do not onboard, and a
 *   plain Error for an IBAN in a country that does not use one (US). Both are
 *   refusals rather than silent drops, because a dropped prefill is invisible
 *   until the restaurant is asked for a field we already had.
 */
export function expressAccountForm(input: ExpressAccountInput): Record<string, string> {
  const country = input.country.trim().toUpperCase();
  const currency = CONNECT_ONBOARDABLE_COUNTRIES[country];
  if (!currency) throw new UnsupportedConnectCountryError(input.country);

  const form: Record<string, string> = {
    // The account TYPE, and it is immutable: Stripe offers no conversion, which
    // is why this migration is cheap only while no tenant has an account.
    type: "express",
    country,
    email: input.email.trim(),
    "business_profile[name]": input.name.trim(),
    "business_profile[mcc]": RESTAURANT_MCC,
    "business_profile[url]": input.url.trim(),
    // All three, unconditionally. See the header: omitting one fails quietly,
    // `card_payments` is refused without `transfers`, and asking for TWINT
    // outside CH is answered `inactive`, not refused.
    "capabilities[card_payments][requested]": "true",
    "capabilities[transfers][requested]": "true",
    "capabilities[twint_payments][requested]": "true",
    // The one field that lets a live account be traced back to a tenant when the
    // registry PR was never merged — i.e. exactly the crash this slice's sibling
    // table (StripeConnectAccount) exists for. Belt and braces, and free.
    "metadata[sofra_tenant]": input.slug,
  };

  const person = input.individual;
  if (person && (person.firstName || person.lastName || person.address)) {
    form.business_type = "individual";
    if (person.firstName) form["individual[first_name]"] = person.firstName.trim();
    if (person.lastName) form["individual[last_name]"] = person.lastName.trim();
    if (person.address) {
      form["individual[address][line1]"] = person.address.line1.trim();
      form["individual[address][city]"] = person.address.city.trim();
      form["individual[address][postal_code]"] = person.address.postalCode.trim();
      form["individual[address][country]"] = country;
    }
  }

  const iban = input.iban?.replace(/\s+/g, "").toUpperCase();
  if (iban) {
    if (NON_IBAN_COUNTRIES.includes(country)) {
      throw new Error(`an IBAN was supplied for ${country}, whose bank accounts Stripe identifies by routing number`);
    }
    form["external_account[object]"] = "bank_account";
    form["external_account[country]"] = country;
    form["external_account[currency]"] = currency;
    form["external_account[account_number]"] = iban;
  }

  return form;
}
