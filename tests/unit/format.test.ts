import { describe, expect, it } from "vitest";
import { eur, shortDate } from "@/lib/format";

// nl-NL currency formatting uses a non-breaking space between € and the value.
const NBSP = "\u00a0";

describe("eur (integer cents → nl-NL EUR string)", () => {
  it("formats whole-plus-cents amounts", () => {
    expect(eur(12345)).toBe(`€${NBSP}123,45`);
  });

  it("formats zero", () => {
    expect(eur(0)).toBe(`€${NBSP}0,00`);
  });

  it("formats single cents with leading zeros", () => {
    expect(eur(7)).toBe(`€${NBSP}0,07`);
  });

  it("groups thousands with dots (nl-NL)", () => {
    expect(eur(123456789)).toBe(`€${NBSP}1.234.567,89`);
  });

  it("formats negative amounts (sign after the € symbol)", () => {
    expect(eur(-500)).toBe(`€${NBSP}-5,00`);
  });
});

describe("shortDate (en-GB dd MMM yyyy)", () => {
  // shortDate formats in the runner's LOCAL timezone (Intl with no timeZone),
  // so build the inputs from local Y/M/D components — a UTC instant could land
  // on a different calendar day in far-east timezones and flake the assertion.
  it("formats a mid-year date", () => {
    expect(shortDate(new Date(2026, 6, 5))).toBe("05 Jul 2026");
  });

  it("zero-pads single-digit days", () => {
    expect(shortDate(new Date(2026, 0, 1))).toBe("01 Jan 2026");
  });

  it("formats an end-of-year date", () => {
    expect(shortDate(new Date(2025, 11, 31))).toBe("31 Dec 2025");
  });
});
