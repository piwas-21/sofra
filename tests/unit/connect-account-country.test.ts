import { describe, expect, it } from "vitest";
import { connectCountryForCurrency } from "@/lib/connect-account-country";
import { CONNECT_ONBOARDABLE_COUNTRIES } from "@/lib/connect-account-request";

// The country an Express account is created in is FIXED FOREVER at creation — Stripe
// refuses it on update, like the account type. sofra holds no country for a tenant
// (neither `SignupRequest` nor the registry has one), so it is derived from the
// currency, and the whole value of this module is in what it REFUSES to derive.

describe("connectCountryForCurrency", () => {
  it("answers CHF, the currency of the first market", () => {
    expect(connectCountryForCurrency("CHF")).toEqual({ ok: true, country: "CH" });
    expect(connectCountryForCurrency("chf")).toEqual({ ok: true, country: "CH" });
    expect(connectCountryForCurrency("  CHF  ")).toEqual({ ok: true, country: "CH" });
  });

  it("refuses EUR, and says why in words a founder can act on", () => {
    // The one that matters. EUR is spoken by FR, DE, NL, IT, ES, BE and AT; picking one
    // would create a LIVE account in the wrong country for a real restaurant, and it
    // cannot be corrected through the API. A refusal costs one hand-edit before merging.
    const verdict = connectCountryForCurrency("EUR");
    expect(verdict.ok).toBe(false);
    expect(!verdict.ok && verdict.reason).toMatch(/EUR does not name one country/);
    expect(!verdict.ok && verdict.reason).toMatch(/FR, DE, NL, IT, ES, BE and AT/);
  });

  it("refuses an absent currency rather than defaulting", () => {
    expect(connectCountryForCurrency(undefined).ok).toBe(false);
    expect(connectCountryForCurrency("").ok).toBe(false);
    expect(connectCountryForCurrency("   ").ok).toBe(false);
  });

  it("refuses a currency it has never been told about", () => {
    for (const c of ["JPY", "SEK", "TRY", "XXX"]) {
      const v = connectCountryForCurrency(c);
      expect(v.ok).toBe(false);
      expect(!v.ok && v.reason).toContain(c);
    }
  });

  it("only ever answers with a country we can actually onboard", () => {
    // The link between the two modules: a derived country that `expressAccountForm`
    // would refuse would be a mint that fails at the boundary for a reason nobody can
    // read. Checked over every currency this module knows, not over a sample.
    for (const currency of ["CHF", "GBP", "USD", "AED"]) {
      const v = connectCountryForCurrency(currency);
      expect(v.ok).toBe(true);
      expect(v.ok && Object.keys(CONNECT_ONBOARDABLE_COUNTRIES)).toContain(v.ok ? v.country : "");
    }
  });
});
