import { describe, expect, it } from "vitest";
import {
  ASSIGNED_COUNTRY_COUNT,
  isAssignedCountryCode,
  isCanonicalCountryCode,
  normalizeCountryCode,
} from "@/lib/country-code";
import { EU_VAT_PREFIXES } from "@/lib/vat-number";

// The list itself is data; what these cases pin is the JUDGEMENT around it —
// which near-misses must be refused, and which codes the rest of the system
// already depends on being present.

describe("isAssignedCountryCode", () => {
  it("accepts the country the live defect was meant to be", () => {
    expect(isAssignedCountryCode("CH")).toBe(true);
  });

  it("refuses SW — the code that was actually stored, assigned to nothing", () => {
    // Nine days on a live billing identity, read as a country by every surface.
    expect(isAssignedCountryCode("SW")).toBe(false);
  });

  it("refuses UK, the common mistake for GB, rather than treating it as a synonym", () => {
    expect(isAssignedCountryCode("UK")).toBe(false);
    expect(isAssignedCountryCode("GB")).toBe(true);
  });

  it("refuses EL and XI — VAT prefixes, not countries", () => {
    // Greece is GR here; EL belongs to lib/vat-number.ts. Northern Ireland's XI
    // describes a VAT registration, and the business is established in GB.
    expect(isAssignedCountryCode("EL")).toBe(false);
    expect(isAssignedCountryCode("XI")).toBe(false);
    expect(isAssignedCountryCode("GR")).toBe(true);
  });

  it("refuses the user-assigned private ranges", () => {
    for (const code of ["AA", "QM", "QZ", "XA", "XZ", "ZZ"]) {
      expect(isAssignedCountryCode(code), code).toBe(false);
    }
  });

  it("refuses anything that is not two letters at all", () => {
    for (const bad of ["", "  ", "C", "CHE", "C1", "12", "N/A", "---"]) {
      expect(isAssignedCountryCode(bad), JSON.stringify(bad)).toBe(false);
    }
    expect(isAssignedCountryCode(null)).toBe(false);
    expect(isAssignedCountryCode(undefined)).toBe(false);
  });

  it("normalises case and whitespace before deciding", () => {
    expect(isAssignedCountryCode(" ch ")).toBe(true);
    expect(isAssignedCountryCode("nL")).toBe(true);
  });

  it("holds every EU member state the VAT module knows, by COUNTRY code", () => {
    // The two lists are keyed differently on purpose (EL vs GR), and this is the
    // seam where that difference has to be handled rather than assumed. If an EU
    // country were missing here, tax-treatment would answer NEEDS_REVIEW for a
    // customer it can price perfectly.
    for (const prefix of EU_VAT_PREFIXES) {
      const country = prefix === "EL" ? "GR" : prefix;
      expect(isAssignedCountryCode(country), country).toBe(true);
    }
  });

  it("holds the seller's own country, without which nothing invoices at all", () => {
    expect(isAssignedCountryCode("NL")).toBe(true);
  });

  it("carries the full ISO 3166-1 alpha-2 assigned list", () => {
    // A count, not a spot check: the failure this guards is a future edit
    // deleting a line, which silently narrows who may be invoiced and shows up
    // as one customer being unable to save their address.
    expect(ASSIGNED_COUNTRY_COUNT).toBe(249);
  });
});

describe("normalizeCountryCode", () => {
  it("uppercases and trims", () => {
    expect(normalizeCountryCode(" ch ")).toBe("CH");
  });

  it("maps absent input to the empty string rather than throwing", () => {
    expect(normalizeCountryCode(null)).toBe("");
    expect(normalizeCountryCode(undefined)).toBe("");
  });
});

describe("isCanonicalCountryCode", () => {
  it("accepts an already-canonical code", () => {
    expect(isCanonicalCountryCode("CH")).toBe(true);
  });

  it("refuses a lowercase or padded code, unlike the forgiving test", () => {
    // A stored row in this shape did not come through the write schema, which
    // uppercases. That is worth stopping on rather than normalising at read time.
    expect(isAssignedCountryCode("ch")).toBe(true);
    expect(isCanonicalCountryCode("ch")).toBe(false);
    expect(isCanonicalCountryCode(" CH")).toBe(false);
  });

  it("still refuses an unassigned code however it is written", () => {
    expect(isCanonicalCountryCode("SW")).toBe(false);
  });

  it("refuses absent input", () => {
    expect(isCanonicalCountryCode(null)).toBe(false);
    expect(isCanonicalCountryCode(undefined)).toBe(false);
  });
});
