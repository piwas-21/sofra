import { describe, expect, it } from "vitest";
import {
  determineTaxTreatment,
  NL_STANDARD_RATE_BPS,
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

  it("holds an EU sale that cannot be substantiated, rather than guessing a rate", () => {
    const held: Exclude<BuyerVatStatus, "VALID">[] = [
      "NONE",
      "UNCHECKED",
      "INVALID",
      "UNAVAILABLE",
    ];
    for (const status of held) {
      const result = determineTaxTreatment(sale({ buyerVatStatus: status }));
      expect(result.treatment, status).toBe("NEEDS_REVIEW");
      // `null`, not 0 and not 21%: an undetermined rate must be impossible to
      // mistake for a determined one, so nothing can auto-issue on it.
      expect(result.rateBps, status).toBeNull();
      expect(result.icpReportable, status).toBe(false);
    }
  });
});

describe("determineTaxTreatment — the partner's actual situation", () => {
  it("holds the invoice today: the number is real but VIES rejects it", () => {
    const result = determineTaxTreatment(sale({ buyerCountry: "FR", buyerVatStatus: "INVALID" }));
    expect(result.treatment).toBe("NEEDS_REVIEW");
    expect(result.reason).toContain("rejected by VIES");
  });

  it("flips to reverse charge the moment the number activates — nothing else changes", () => {
    expect(determineTaxTreatment(sale({ buyerVatStatus: "VALID" })).treatment).toBe(
      "EU_REVERSE_CHARGE",
    );
  });

  it("refuses to substantiate a reverse charge on an unreachable VIES", () => {
    // The audit-facing case: "we could not check" is not evidence, and a busy
    // member state must never widen into a 0% invoice.
    const result = determineTaxTreatment(sale({ buyerVatStatus: "UNAVAILABLE" }));
    expect(result.treatment).toBe("NEEDS_REVIEW");
    expect(result.reason).toContain("VIES could not be reached");
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
