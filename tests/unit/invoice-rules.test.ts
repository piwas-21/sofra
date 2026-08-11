import { describe, expect, it } from "vitest";
import {
  formatInvoiceNumber,
  issueBlocker,
  splitGross,
  type IssueBlocker,
} from "@/lib/invoice-rules";
import { NL_STANDARD_RATE_BPS } from "@/lib/tax-treatment";

describe("splitGross — the charged amount is VAT-INCLUSIVE", () => {
  it("splits a Dutch charge into net + VAT that add back exactly", () => {
    // €69.00 charged to a Dutch customer at 21%. Nothing in this system has ever
    // ADDED VAT to a subscription — Mollie charges the catalogue price — so €69
    // is all the money that arrived, and reading it as net instead would declare
    // €14.49 of VAT on €14.49 that never came in, out of Sofra's own margin.
    const t = splitGross(6900, NL_STANDARD_RATE_BPS);
    expect(t).toEqual({ netCents: 5702, vatCents: 1198, grossCents: 6900, rateBps: 2100 });
    expect(t.netCents + t.vatCents).toBe(t.grossCents);
  });

  it("always reconciles to the payment, across a wide range of amounts", () => {
    // The property that matters at year end: net + VAT must equal the money that
    // actually moved, for every amount, with no one-cent drift.
    for (let gross = 1; gross <= 20_000; gross += 7) {
      const t = splitGross(gross, NL_STANDARD_RATE_BPS);
      expect(t.netCents + t.vatCents, `gross ${gross}`).toBe(gross);
      expect(t.vatCents, `gross ${gross}`).toBeGreaterThanOrEqual(0);
    }
  });

  it("leaves a 0% supply entirely alone — net IS gross", () => {
    // Reverse charge and outside-scope. No rounding question arises at all.
    expect(splitGross(6900, 0)).toEqual({
      netCents: 6900,
      vatCents: 0,
      grossCents: 6900,
      rateBps: 0,
    });
  });

  it("treats a negative rate as 0 rather than inventing a credit", () => {
    expect(splitGross(6900, -1)).toMatchObject({ netCents: 6900, vatCents: 0, rateBps: 0 });
  });

  it("handles a zero charge without dividing into nothing", () => {
    expect(splitGross(0, NL_STANDARD_RATE_BPS)).toMatchObject({ netCents: 0, vatCents: 0 });
  });

  it("rounds the NET and derives VAT, never the other way round", () => {
    // 1 cent at 21%: net rounds to 1, so VAT is 0 — and the total still matches
    // the payment. Rounding each independently could produce 1 + 1 = 2 against a
    // 1-cent charge.
    const t = splitGross(1, NL_STANDARD_RATE_BPS);
    expect(t.netCents + t.vatCents).toBe(1);
  });
});

describe("formatInvoiceNumber", () => {
  it("zero-pads within a series and year", () => {
    expect(formatInvoiceNumber("SP", 2026, 1)).toBe("SP-2026-0001");
    expect(formatInvoiceNumber("SP", 2026, 42)).toBe("SP-2026-0042");
  });

  it("does not truncate once the series passes four digits", () => {
    // Padding is a minimum width, not a cap — an invoice number must never be
    // silently reused because the format ran out of room.
    expect(formatInvoiceNumber("SP", 2026, 12345)).toBe("SP-2026-12345");
  });

  it("keeps years separate, so each starts at 0001", () => {
    expect(formatInvoiceNumber("SP", 2027, 1)).toBe("SP-2027-0001");
  });
});

describe("issueBlocker — every refusal is a stop, not a fallback", () => {
  const ok = {
    sellerConfigured: true,
    buyerInvoiceable: true,
    treatment: "EU_REVERSE_CHARGE" as const,
    grossCents: 6900,
  };

  it("permits a complete, determinable sale", () => {
    expect(issueBlocker(ok)).toBeNull();
  });

  it("refuses when the company's own details are not configured", () => {
    // The B0 owner-input interlock. A placeholder KVK on a real invoice is worse
    // than no invoice, because it looks finished.
    expect(issueBlocker({ ...ok, sellerConfigured: false })).toBe("sellerNotConfigured");
  });

  it("refuses when the customer's identity is incomplete", () => {
    expect(issueBlocker({ ...ok, buyerInvoiceable: false })).toBe("buyerNotInvoiceable");
  });

  it("refuses when the tax treatment is a judgement call", () => {
    // The partner's live situation: a real VAT number VIES has not confirmed.
    // Issuing anyway would mean picking a rate the law leaves to a human.
    expect(issueBlocker({ ...ok, treatment: "NEEDS_REVIEW" })).toBe("taxNeedsReview");
  });

  it("refuses a zero or negative charge", () => {
    expect(issueBlocker({ ...ok, grossCents: 0 })).toBe("nothingToInvoice");
    expect(issueBlocker({ ...ok, grossCents: -100 })).toBe("nothingToInvoice");
  });

  it("reports the seller gap FIRST — it blocks every invoice, not just this one", () => {
    const all: IssueBlocker = issueBlocker({
      sellerConfigured: false,
      buyerInvoiceable: false,
      treatment: "NEEDS_REVIEW",
      grossCents: 0,
    })!;
    expect(all).toBe("sellerNotConfigured");
  });

  it("permits the two 0% treatments and the domestic one alike", () => {
    for (const treatment of ["NL_STANDARD", "EU_REVERSE_CHARGE", "OUTSIDE_SCOPE"] as const) {
      expect(issueBlocker({ ...ok, treatment }), treatment).toBeNull();
    }
  });
});
