import { describe, expect, it } from "vitest";
import {
  DEFAULT_COMMISSION_BPS,
  MAX_COMMISSION_BPS,
  crossoverCentsPerMonth,
  isCommissionBps,
  paymentsModeQuote,
} from "@/lib/payments-pricing";
import { MODULES } from "@/lib/module-catalog";

// The online-payments list price this whole file measures against — read out of
// the SAME catalog paymentsModeQuote reads, never hardcoded, so a future price
// change cannot make this suite pass against a number nobody actually charges.
const ONLINE_PAYMENTS_PRICE_CENTS = MODULES.find((m) => m.id === "online-payments")!.priceCents;

describe("isCommissionBps", () => {
  it("rejects negative rates — a negative fee is not a rate, it is a bug", () => {
    expect(isCommissionBps(-1)).toBe(false);
    expect(isCommissionBps(-150)).toBe(false);
  });

  it("rejects anything above the 1000 bps (10%) ceiling", () => {
    expect(isCommissionBps(1001)).toBe(false);
    expect(isCommissionBps(5000)).toBe(false);
  });

  // The boundary test: `>` vs `>=` at the ceiling is otherwise indistinguishable
  // from any other passing case, so 1000 itself has to be asserted explicitly.
  it("accepts exactly 1000 bps — the ceiling itself is a valid rate, not the first refusal", () => {
    expect(isCommissionBps(MAX_COMMISSION_BPS)).toBe(true);
    expect(MAX_COMMISSION_BPS).toBe(1000);
  });

  it("accepts 0 (no commission) and the shipped default", () => {
    expect(isCommissionBps(0)).toBe(true);
    expect(isCommissionBps(DEFAULT_COMMISSION_BPS)).toBe(true);
    expect(DEFAULT_COMMISSION_BPS).toBe(150);
  });

  it("rejects a fractional rate — provision-tenant.sh parses the registry field with ^[0-9]+$", () => {
    expect(isCommissionBps(1.5)).toBe(false);
    expect(isCommissionBps(150.001)).toBe(false);
  });
});

describe("paymentsModeQuote", () => {
  it("leaves a flat-mode quote unchanged, module present or not", () => {
    expect(paymentsModeQuote(4500, "flat", true)).toBe(4500);
    expect(paymentsModeQuote(4500, "flat", false)).toBe(4500);
  });

  it("zeroes the online-payments line under commission mode", () => {
    const withModule = 1900 + ONLINE_PAYMENTS_PRICE_CENTS;
    expect(paymentsModeQuote(withModule, "commission", true)).toBe(
      withModule - ONLINE_PAYMENTS_PRICE_CENTS,
    );
  });

  it("leaves a tenant without the module unaffected by commission mode — nothing to subtract", () => {
    // A tenant that never bought online-payments has no line to zero: subtracting
    // the module's price anyway would UNDER-charge them for modules they do carry.
    expect(paymentsModeQuote(3600, "commission", false)).toBe(3600);
  });
});

describe("crossoverCentsPerMonth", () => {
  it("returns null at 0 bps — commission is free forever, not merely a high crossover", () => {
    expect(crossoverCentsPerMonth(0, 1900)).toBeNull();
  });

  // Hand-derived: turnover * (bps/10000) = flatCents => turnover = flatCents*10000/bps.
  // At the shipped default (150 bps) against the online-payments list price (1900
  // cents/€19), that is 1900*10000/150 = 126666.67, rounded to the nearest cent —
  // which is the plan's own "roughly CHF 1,270/mo" sentence (SOFRA-PAYMENTS-PRICING-MODE-PLAN §1).
  it("computes the plan's own worked example: 150 bps against the €19 module", () => {
    expect(crossoverCentsPerMonth(DEFAULT_COMMISSION_BPS, ONLINE_PAYMENTS_PRICE_CENTS)).toBe(126667);
  });

  // A second, exact (non-repeating) example so the formula itself — not just its
  // rounding — is pinned: 100 bps (1%) of 100000 cents (€1000) is exactly 1000
  // cents (€10), so the crossover for a €10 flat fee at 1% is exactly €1000/mo.
  it("computes an exact round-number crossover with no rounding involved", () => {
    expect(crossoverCentsPerMonth(100, 1000)).toBe(100000);
  });
});
