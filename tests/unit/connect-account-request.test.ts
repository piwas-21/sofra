import { describe, expect, it } from "vitest";
import {
  CONNECT_ONBOARDABLE_COUNTRIES,
  RESTAURANT_MCC,
  UnsupportedConnectCountryError,
  expressAccountForm,
  type ExpressAccountInput,
} from "@/lib/connect-account-request";
import { createExpressAccount } from "@/lib/stripe-connect-accounts";

// Every expectation below is pinned to a MEASUREMENT against Stripe TEST mode on
// 2026-09-05 (platform acct_1TpwTNCAHTt6eZ8i; every probe account deleted after,
// GET -> 403), not to the documentation.

const input = (over: Partial<ExpressAccountInput> = {}): ExpressAccountInput => ({
  slug: "rumi",
  country: "CH",
  email: "owner@example.com",
  name: "RUMI Restaurant",
  url: "https://rumi.sofrapiwas.com",
  ...over,
});

describe("expressAccountForm — the capabilities", () => {
  it("requests card_payments, transfers AND twint_payments in the one create call", () => {
    // The runbook's §2b.1 warning, and the reason this is three unconditional
    // lines: omitting a capability fails QUIETLY — a 200 carrying an account
    // that can never take a card. `card_payments` is additionally refused
    // without `transfers`, and prefill is create-only, so there is no second
    // chance to ask.
    const form = expressAccountForm(input());
    expect(form["capabilities[card_payments][requested]"]).toBe("true");
    expect(form["capabilities[transfers][requested]"]).toBe("true");
    expect(form["capabilities[twint_payments][requested]"]).toBe("true");
  });

  it("asks for TWINT outside Switzerland too", () => {
    // MEASURED: an FR Express account created with twint_payments requested
    // returned 200 and reported that capability `inactive` /
    // `requirements.fields_needed` — NOT a refusal. So the list stays
    // unconditional, and no country branch can silently drop a capability.
    expect(expressAccountForm(input({ country: "FR" }))["capabilities[twint_payments][requested]"]).toBe("true");
  });
});

describe("expressAccountForm — the account itself", () => {
  it("is an EXPRESS account and normalises the country", () => {
    // The type is immutable at Stripe — there is no conversion — which is what
    // makes this migration cheap only while no tenant has an account.
    const form = expressAccountForm(input({ country: "ch" }));
    expect(form.type).toBe("express");
    expect(form.country).toBe("CH");
  });

  it("tags the account with the tenant slug", () => {
    // The only field that can trace a LIVE account back to a tenant when the
    // registry PR was never merged.
    expect(expressAccountForm(input())["metadata[sofra_tenant]"]).toBe("rumi");
  });

  it("prefills the business profile every restaurant has", () => {
    const form = expressAccountForm(input());
    expect(form["business_profile[name]"]).toBe("RUMI Restaurant");
    expect(form["business_profile[mcc]"]).toBe(RESTAURANT_MCC);
    expect(form["business_profile[mcc]"]).toBe("5812");
    expect(form["business_profile[url]"]).toBe("https://rumi.sofrapiwas.com");
    expect(form.email).toBe("owner@example.com");
  });
});

describe("expressAccountForm — the country boundary", () => {
  it("refuses TR, which Stripe itself refuses", () => {
    // MEASURED: `POST /v1/accounts country=TR` -> 400 `country_unsupported`,
    // "TR is not currently supported by Stripe". We refuse BEFORE the call so
    // the message names the tenant and no half-built account can exist.
    expect(() => expressAccountForm(input({ country: "TR" }))).toThrow(UnsupportedConnectCountryError);
    expect(() => expressAccountForm(input({ country: "tr" }))).toThrow(/TR/);
  });

  it("refuses anything else it has not been told about", () => {
    // An allowlist, not a "not TR" denylist: a country nobody thought about
    // announces itself as a readable refusal instead of being discovered at
    // Stripe, or later at the restaurant.
    for (const bad of ["", "CHE", "XX", "SW", "JP"]) {
      expect(() => expressAccountForm(input({ country: bad }))).toThrow(UnsupportedConnectCountryError);
    }
  });

  it("accepts every country the runbook offers", () => {
    // The positive control for the two refusals above: a rule that refused
    // everything would pass both of them.
    for (const country of Object.keys(CONNECT_ONBOARDABLE_COUNTRIES)) {
      expect(expressAccountForm(input({ country })).country).toBe(country);
    }
    expect(Object.keys(CONNECT_ONBOARDABLE_COUNTRIES)).toContain("CH");
  });
});

describe("expressAccountForm — business_type is a commitment, not a hint", () => {
  it("sends no business_type and no individual fields when we know no person", () => {
    // MEASURED both ways. Without a business type a prefilled CH account has 13
    // `currently_due`; with `business_type=individual` plus name and address it
    // has 6. But `business_type` is refused on UPDATE (403 oauth_not_supported),
    // so guessing "individual" for what turns out to be a company is a live
    // account that cannot be corrected through the API. 13 beats wrong.
    const form = expressAccountForm(input());
    expect(form.business_type).toBeUndefined();
    expect(Object.keys(form).some((k) => k.startsWith("individual["))).toBe(false);
  });

  it("sends business_type=individual as soon as any individual field is given", () => {
    // MEASURED: `individual[...]` without `business_type` is a hard 400 — "The
    // business_type must be provided when sending either of individual or
    // company parameters". So the two travel together or not at all.
    const form = expressAccountForm(
      input({
        individual: {
          firstName: "Ada",
          lastName: "Lovelace",
          address: { line1: "Rue du Test 1", city: "Geneve", postalCode: "1201" },
        },
      }),
    );
    expect(form.business_type).toBe("individual");
    expect(form["individual[first_name]"]).toBe("Ada");
    expect(form["individual[last_name]"]).toBe("Lovelace");
    expect(form["individual[address][line1]"]).toBe("Rue du Test 1");
    expect(form["individual[address][city]"]).toBe("Geneve");
    expect(form["individual[address][postal_code]"]).toBe("1201");
  });

  it("puts the ACCOUNT's country on the individual address", () => {
    // The address has no country of its own in the input on purpose: a person
    // resident in a different country from the account is a case Stripe asks
    // about in its own flow, and inventing an answer here would prefill a wrong
    // one into a field that cannot be updated.
    const form = expressAccountForm(
      input({ country: "fr", individual: { address: { line1: "1 rue", city: "Lyon", postalCode: "69001" } } }),
    );
    expect(form["individual[address][country]"]).toBe("FR");
    expect(form.business_type).toBe("individual");
  });

  it("does not commit a business type for an empty individual block", () => {
    expect(expressAccountForm(input({ individual: {} })).business_type).toBeUndefined();
  });
});

describe("expressAccountForm — the IBAN", () => {
  it("attaches it as the external account, in the country's own currency", () => {
    // MEASURED: an IBAN passed as `external_account` on create returns
    // `external_accounts.total_count: 1` — the payout destination is prefilled
    // and the restaurant never types it. This is the answer to "can we just
    // collect the IBAN": yes, and only here.
    const form = expressAccountForm(input({ iban: "CH93 0076 2011 6238 5295 7" }));
    expect(form["external_account[object]"]).toBe("bank_account");
    expect(form["external_account[country]"]).toBe("CH");
    expect(form["external_account[currency]"]).toBe("chf");
    expect(form["external_account[account_number]"]).toBe("CH9300762011623852957");
  });

  it("denominates the account in the country's currency, not always CHF", () => {
    expect(expressAccountForm(input({ country: "FR", iban: "FR7630006000011234567890189" }))["external_account[currency]"]).toBe("eur");
    expect(expressAccountForm(input({ country: "GB", iban: "GB33BUKB20201555555555" }))["external_account[currency]"]).toBe("gbp");
  });

  it("sends no external_account at all when we hold no IBAN", () => {
    // Not an empty one: Stripe reads an empty string as a value, and a blank
    // payout destination is a field the restaurant then has to clear by hand.
    const form = expressAccountForm(input());
    expect(Object.keys(form).some((k) => k.startsWith("external_account"))).toBe(false);
  });

  it("refuses an IBAN for a country that does not use one", () => {
    // Dropping it silently is the failure mode this whole module is written
    // against: an invisible non-prefill, discovered when the restaurant is asked
    // for something we already had.
    expect(() => expressAccountForm(input({ country: "US", iban: "CH9300762011623852957" }))).toThrow(/routing number/);
  });
});

describe("createExpressAccount — the order of its refusals", () => {
  // These assert something no pure test can: that the offline refusals happen
  // BEFORE the database read and before the Stripe call. If either refusal moved
  // below them, these tests would reach a real network/DB in a suite that has
  // neither and would fail — which is the point.
  it("refuses a non-registry slug before anything else", async () => {
    await expect(createExpressAccount({ slug: "", country: "CH", email: "a@example.com", name: "n", url: "https://x" })).rejects.toThrow(
      /non-registry slug/,
    );
  });

  it("refuses an unsupported country before anything else", async () => {
    await expect(
      createExpressAccount({ slug: "rumi", country: "TR", email: "a@example.com", name: "n", url: "https://x" }),
    ).rejects.toThrow(UnsupportedConnectCountryError);
  });
});
