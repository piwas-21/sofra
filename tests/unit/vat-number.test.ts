import { describe, expect, it } from "vitest";
import {
  checkVatFormat,
  isEuVatPrefix,
  normalizeVatNumber,
  vatCountryOf,
} from "@/lib/vat-number";

describe("normalizeVatNumber", () => {
  it("strips the separators people actually paste, and uppercases", () => {
    expect(normalizeVatNumber("fr 27 981 106 214")).toBe("FR27981106214");
    expect(normalizeVatNumber("NL-8123.45678.B01")).toBe("NL812345678B01");
  });

  it("strips a non-breaking space — the one a copy-paste from a PDF leaves behind", () => {
    expect(normalizeVatNumber("FR 27981106214")).toBe("FR27981106214");
  });

  it("is idempotent, so a stored value never drifts from a re-normalized one", () => {
    const once = normalizeVatNumber(" fr 27 981 106 214 ");
    expect(normalizeVatNumber(once)).toBe(once);
  });
});

describe("vatCountryOf / isEuVatPrefix", () => {
  it("reads Greece as EL, which is its VAT prefix", () => {
    expect(isEuVatPrefix("EL")).toBe(true);
    expect(vatCountryOf("EL123456789")).toBe("EL");
  });

  it("does not treat GR as a VAT prefix — Greece never issues one", () => {
    expect(isEuVatPrefix("GR")).toBe(false);
  });

  it("rejects non-EU prefixes, including the UK and Switzerland", () => {
    expect(vatCountryOf("GB123456789")).toBeNull();
    expect(vatCountryOf("CHE123456789")).toBeNull();
    // XI (Northern Ireland) is in the EU VAT area for GOODS only. Sofra sells a
    // service, so it must not resolve here.
    expect(vatCountryOf("XI123456789")).toBeNull();
  });
});

describe("checkVatFormat — the trigger case", () => {
  it("accepts the partner's number: the French key matches its SIREN", () => {
    // key = (12 + 3 × (981106214 mod 97)) mod 97 = (12 + 15) mod 97 = 27
    const verdict = checkVatFormat("FR27981106214");
    expect(verdict).toEqual({ ok: true, country: "FR", national: "27981106214" });
  });

  it("REJECTS the bare SIREN — the trap that made VIES answer INVALID", () => {
    // 9 digits is a SIREN, not a French VAT number. Queried against VIES it comes
    // back INVALID, indistinguishable from a real negative. Caught by shape here
    // so no call is ever spent learning it.
    expect(checkVatFormat("FR981106214")).toEqual({ ok: false, reason: "badFormat" });
  });

  it("rejects a French number whose key contradicts its SIREN", () => {
    expect(checkVatFormat("FR28981106214")).toEqual({ ok: false, reason: "badChecksum" });
  });

  it("accepts a French number with an ALPHANUMERIC key without checking arithmetic", () => {
    // Newer French registrations carry a non-numeric key for which the mod-97
    // identity does not hold. Enforcing it would refuse valid numbers, so the
    // check is skipped and VIES decides.
    expect(checkVatFormat("FRAB981106214")).toMatchObject({ ok: true, country: "FR" });
  });
});

describe("checkVatFormat — refusals", () => {
  it("distinguishes empty from malformed, so a form can say something useful", () => {
    expect(checkVatFormat("")).toEqual({ ok: false, reason: "empty" });
    expect(checkVatFormat("   ")).toEqual({ ok: false, reason: "empty" });
  });

  it("names an unknown country separately from a bad national part", () => {
    expect(checkVatFormat("ZZ123456789")).toEqual({ ok: false, reason: "unknownCountry" });
    expect(checkVatFormat("DE12345")).toEqual({ ok: false, reason: "badFormat" });
  });

  it("rejects a country code with no national part at all", () => {
    expect(checkVatFormat("NL")).toEqual({ ok: false, reason: "badFormat" });
  });
});

describe("checkVatFormat — the countries we must never falsely reject", () => {
  it("accepts a RANDOM Dutch sole-trader btw-id that fails the historical 11-proof", () => {
    // Since 2020 the Dutch btw-id for a natural person is randomly generated and
    // does NOT satisfy the 11-proof. Enforcing that checksum would reject exactly
    // the smallest, newest Dutch customers — valid numbers, refused by us.
    expect(checkVatFormat("NL000000000B01")).toMatchObject({ ok: true, country: "NL" });
    expect(checkVatFormat("NL123456789B01")).toMatchObject({ ok: true, country: "NL" });
  });

  it("accepts well-formed numbers across the shapes that are not plain digits", () => {
    const cases = [
      "ATU12345678",
      "BE0123456789",
      "CY12345678L",
      "ESA12345678",   // leading letter
      "ESX12345678",   // trailing alphanumeric
      "IE1234567FA",
      "IE1A23456B",    // the old second-character form
      "LT123456789012",
      "SE123456789012",
      "RO12",          // Romanian numbers are as short as two digits
    ];
    for (const c of cases) {
      expect(checkVatFormat(c), `${c} should pass format`).toMatchObject({ ok: true });
    }
  });

  it("passes every non-French country through without a checksum verdict", () => {
    // The rule this pins: a pre-filter may only refuse what VIES would certainly
    // refuse too. A shape-valid German number is never `badChecksum` here.
    expect(checkVatFormat("DE999999999")).toMatchObject({ ok: true, country: "DE" });
  });
});
