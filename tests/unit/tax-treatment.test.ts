import { describe, expect, it } from "vitest";
import {
  determineTaxTreatment,
  NL_STANDARD_RATE_BPS,
  EU_NO_VAT_NOTE,
  OUTSIDE_SCOPE_NOTE,
  REVERSE_CHARGE_NOTE,
  type BuyerVatStatus,
  type TaxTreatmentInput,
} from "@/lib/tax-treatment";

const sale = (over: Partial<TaxTreatmentInput> = {}): TaxTreatmentInput => ({
  sellerCountry: "NL",
  buyerCountry: "FR",
  buyerVatStatus: "VALID",
  ...over,
});

describe("determineTaxTreatment — the four rows of the §4 matrix", () => {
  it("charges 21% on a domestic Dutch sale", () => {
    expect(determineTaxTreatment(sale({ buyerCountry: "NL" }))).toMatchObject({
      treatment: "NL_STANDARD",
      rateBps: NL_STANDARD_RATE_BPS,
      invoiceNote: null,
      icpReportable: false,
    });
  });

  it("reverse-charges an EU business holding a VIES-valid number", () => {
    expect(determineTaxTreatment(sale())).toMatchObject({
      treatment: "EU_REVERSE_CHARGE",
      rateBps: 0,
      invoiceNote: REVERSE_CHARGE_NOTE,
      icpReportable: true,
    });
  });

  it("puts a Swiss tenant (RUMI) outside the scope of EU VAT, and off the ICP", () => {
    expect(determineTaxTreatment(sale({ buyerCountry: "CH", buyerVatStatus: "NONE" }))).toMatchObject(
      {
        treatment: "OUTSIDE_SCOPE",
        rateBps: 0,
        invoiceNote: OUTSIDE_SCOPE_NOTE,
        icpReportable: false,
      },
    );
  });

  it("charges Dutch VAT on an unsubstantiated EU sale, under the default policy", () => {
    // Two readings are defensible here (Dutch VAT for an unverified business, the
    // buyer's own rate under OSS for a consumer), so this is a stated POLICY, not
    // a guess — and `nlVat` is the conservative one: 21% is collected and
    // remitted, so the sale can never turn out to have been under-declared.
    // UNAVAILABLE is deliberately NOT in this list — see the test below.
    const unverified: Exclude<BuyerVatStatus, "VALID" | "UNAVAILABLE">[] = [
      "NONE",
      "UNCHECKED",
      "INVALID",
    ];
    for (const status of unverified) {
      const result = determineTaxTreatment(sale({ buyerVatStatus: status }));
      expect(result.treatment, status).toBe("NL_STANDARD");
      expect(result.rateBps, status).toBe(NL_STANDARD_RATE_BPS);
      // NEVER on the ICP: nothing was reverse-charged, so listing it would report
      // an intra-EU supply that did not happen.
      expect(result.icpReportable, status).toBe(false);
      expect(result.invoiceNote, status).toBe(EU_NO_VAT_NOTE);
    }
  });

  it("HOLDS an unreachable VIES under EITHER policy — an outage is not a verdict", () => {
    // The costly case, and the one the fallback must never swallow. UNAVAILABLE
    // is "we have not finished asking", and it self-clears — while VIES throttled
    // 5 of 8 calls on the French node, so it is the MODAL state, not an edge.
    //
    // Issuing on it is one-directional: the invoice is immutable and credit notes
    // are not built, so a recheck returning VALID an hour later cannot undo a 21%
    // document. Gross is fixed, so that 21% comes out of Sofra's own margin —
    // €11.98 of every €69 — for a buyer who was entitled to a reverse charge.
    for (const euNoVatFallback of ["nlVat", "hold"] as const) {
      const r = determineTaxTreatment(sale({ buyerVatStatus: "UNAVAILABLE", euNoVatFallback }));
      expect(r.treatment, euNoVatFallback).toBe("NEEDS_REVIEW");
      expect(r.rateBps, euNoVatFallback).toBeNull();
    }
  });

  it("still HOLDS when the policy says so, and holds with no rate at all", () => {
    for (const status of ["NONE", "UNCHECKED", "INVALID"] as const) {
      const result = determineTaxTreatment(
        sale({ buyerVatStatus: status, euNoVatFallback: "hold" }),
      );
      expect(result.treatment, status).toBe("NEEDS_REVIEW");
      // `null`, not 0 and not 21%: an undetermined rate must be impossible to
      // mistake for a determined one, so nothing can auto-issue on it.
      expect(result.rateBps, status).toBeNull();
    }
  });

  it("a VALID number still reverse-charges — the policy only covers the unverified", () => {
    for (const euNoVatFallback of ["nlVat", "hold"] as const) {
      expect(determineTaxTreatment(sale({ euNoVatFallback })).treatment).toBe(
        "EU_REVERSE_CHARGE",
      );
    }
  });
});

describe("determineTaxTreatment — the partner's actual situation", () => {
  it("invoices at Dutch VAT today: the number is real but VIES rejects it", () => {
    const result = determineTaxTreatment(sale({ buyerCountry: "FR", buyerVatStatus: "INVALID" }));
    expect(result.treatment).toBe("NL_STANDARD");
    // The cause survives into the reason even though the sale now proceeds — an
    // operator reading the invoice must still be able to see WHY it was 21%.
    expect(result.reason).toContain("rejected by VIES");
  });

  it("flips to reverse charge the moment the number activates — nothing else changes", () => {
    expect(determineTaxTreatment(sale({ buyerVatStatus: "VALID" })).treatment).toBe(
      "EU_REVERSE_CHARGE",
    );
  });

  it("neither charges nor zero-rates an unreachable VIES — it stops", () => {
    // Asserted POSITIVELY. An earlier version of this test said only
    // `not.toBe("EU_REVERSE_CHARGE")`, which NL_STANDARD satisfies — so it went
    // on passing while the behaviour it is named after regressed underneath it.
    for (const euNoVatFallback of ["nlVat", "hold"] as const) {
      const result = determineTaxTreatment(sale({ buyerVatStatus: "UNAVAILABLE", euNoVatFallback }));
      expect(result.treatment, euNoVatFallback).toBe("NEEDS_REVIEW");
      expect(result.rateBps, euNoVatFallback).toBeNull();
      expect(result.icpReportable, euNoVatFallback).toBe(false);
      expect(result.reason).toContain("VIES could not be reached");
    }
  });
});

describe("determineTaxTreatment — country handling", () => {
  it("treats Greece as EU under BOTH its country code and its VAT prefix", () => {
    // GR is the ISO country code; EL is the VAT prefix. Testing only the prefix
    // list would push every Greek customer to NEEDS_REVIEW.
    expect(determineTaxTreatment(sale({ buyerCountry: "GR" })).treatment).toBe(
      "EU_REVERSE_CHARGE",
    );
    expect(determineTaxTreatment(sale({ buyerCountry: "EL" })).treatment).toBe(
      "EU_REVERSE_CHARGE",
    );
  });

  it("accepts lowercase input on both countries", () => {
    expect(
      determineTaxTreatment({ sellerCountry: "nl", buyerCountry: "nl", buyerVatStatus: "NONE" })
        .treatment,
    ).toBe("NL_STANDARD");
  });

  it("puts the UK outside the scope — it left the EU VAT area for services", () => {
    expect(determineTaxTreatment(sale({ buyerCountry: "GB" })).treatment).toBe("OUTSIDE_SCOPE");
  });

  it("stops on a missing or malformed buyer country instead of assuming one", () => {
    for (const buyerCountry of ["", "F", "FRA", "12"]) {
      expect(determineTaxTreatment(sale({ buyerCountry })).treatment, buyerCountry).toBe(
        "NEEDS_REVIEW",
      );
    }
  });

  it("stops on a well-formed code that is not a country, instead of zero-rating it", () => {
    // The defect this rule was written for. `SW` is not assigned to anything, so
    // every EU test below it is false and the old code answered OUTSIDE_SCOPE at
    // 0% — with a confident reason naming a country that does not exist. For the
    // Swiss buyer it was stored on, the verdict was right and the evidence was
    // wrong; for a mistyped EU country it would be an immutable under-charge.
    for (const buyerCountry of ["SW", "UK", "XX", "QQ"]) {
      const result = determineTaxTreatment(sale({ buyerCountry }));
      expect(result.treatment, buyerCountry).toBe("NEEDS_REVIEW");
      expect(result.rateBps, buyerCountry).toBeNull();
      expect(result.reason, buyerCountry).toContain("not an assigned ISO 3166-1 code");
    }
  });

  it("keeps Switzerland outside the scope once it is spelled CH", () => {
    // The same customer, correctly recorded: still 0%, but now on a country the
    // reason can name and an auditor can check.
    const result = determineTaxTreatment(sale({ buyerCountry: "CH" }));
    expect(result.treatment).toBe("OUTSIDE_SCOPE");
    expect(result.rateBps).toBe(0);
  });

  it("says a missing country is missing, rather than calling it unassigned", () => {
    expect(determineTaxTreatment(sale({ buyerCountry: "" })).reason).toBe(
      "buyer country is missing",
    );
  });

  it("stops if the seller is not NL — the whole matrix is Dutch-establishment law", () => {
    const result = determineTaxTreatment(sale({ sellerCountry: "BE" }));
    expect(result.treatment).toBe("NEEDS_REVIEW");
    expect(result.reason).toContain("not modelled");
  });

  it("names an unset seller country explicitly rather than printing nothing", () => {
    expect(determineTaxTreatment(sale({ sellerCountry: "" })).reason).toContain("(unset)");
  });
});

describe("the reverse-charge note", () => {
  it('says "reverse-charged" and never "0%"', () => {
    // A zero RATE and a TRANSFER of liability are different things in law, and an
    // invoice claiming the former for the latter is wrong even though both show
    // no money. This is the classic Dutch invoicing error.
    expect(REVERSE_CHARGE_NOTE).toMatch(/reverse-charged/i);
    expect(REVERSE_CHARGE_NOTE).not.toMatch(/0\s*%/);
    expect(REVERSE_CHARGE_NOTE).toContain("art. 196");
  });
});
