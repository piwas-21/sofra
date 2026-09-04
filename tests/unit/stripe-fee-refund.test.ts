import { describe, expect, it } from "vitest";
import { feeRefundAmount } from "@/lib/stripe-fee-refund";

describe("feeRefundAmount", () => {
  it("returns the whole fee on a full refund", () => {
    expect(
      feeRefundAmount({ chargeAmount: 4000, chargeAmountRefunded: 4000, feeAmount: 60, feeAmountRefunded: 0 }),
    ).toBe(60);
  });

  it("owes nothing when nothing has been refunded", () => {
    expect(
      feeRefundAmount({ chargeAmount: 4000, chargeAmountRefunded: 0, feeAmount: 60, feeAmountRefunded: 0 }),
    ).toBe(0);
  });

  it("prorates a half refund", () => {
    expect(
      feeRefundAmount({ chargeAmount: 4000, chargeAmountRefunded: 2000, feeAmount: 60, feeAmountRefunded: 0 }),
    ).toBe(30);
  });

  it("is idempotent: a redelivery after the fee is already fully refunded owes 0", () => {
    expect(
      feeRefundAmount({ chargeAmount: 4000, chargeAmountRefunded: 4000, feeAmount: 60, feeAmountRefunded: 60 }),
    ).toBe(0);
  });

  it("owes only the remainder when part of the fee was already returned", () => {
    expect(
      feeRefundAmount({ chargeAmount: 4000, chargeAmountRefunded: 4000, feeAmount: 60, feeAmountRefunded: 30 }),
    ).toBe(30);
  });

  it("rounds the MIDPOINT half away from zero (the rounding-mode discriminator)", () => {
    // 5 * 2000 / 4000 = 2.5 exactly — the one input where half-away-from-zero
    // (3) and banker's/round-half-to-even (2) actually disagree. A value like
    // 4.995 would NOT discriminate: every rounding mode returns 5 for it.
    expect(
      feeRefundAmount({ chargeAmount: 4000, chargeAmountRefunded: 2000, feeAmount: 5, feeAmountRefunded: 0 }),
    ).toBe(3);
  });

  it("a quarter refund against a fee already refunded past that share owes 0, not negative", () => {
    expect(
      feeRefundAmount({ chargeAmount: 4000, chargeAmountRefunded: 1000, feeAmount: 60, feeAmountRefunded: 60 }),
    ).toBe(0);
  });

  it("never divides by zero on a zero-amount charge", () => {
    expect(
      feeRefundAmount({ chargeAmount: 0, chargeAmountRefunded: 0, feeAmount: 60, feeAmountRefunded: 0 }),
    ).toBe(0);
  });

  it("clamps due to what remains of the fee, even on a rounding overshoot", () => {
    expect(
      feeRefundAmount({ chargeAmount: 4000, chargeAmountRefunded: 4000, feeAmount: 60, feeAmountRefunded: 55 }),
    ).toBe(5);
  });

  // The ceiling clamp is UNREACHABLE through Stripe: a charge cannot report more
  // refunded than its own amount, so `target` can never exceed `feeAmount`. That
  // makes it defensive code — and defensive code nothing exercises is a guard
  // nobody can show works. Proven by mutation: deleting the `Math.min(...)` left
  // every other case in this file green.
  //
  // So this feeds it the impossible input directly. Without the clamp the answer
  // is 75, and we would ask Stripe to refund MORE than the fee it is refunding
  // against — a request Stripe rejects, turning a silent upstream anomaly into a
  // failing webhook that retries forever.
  it("never asks to refund more than the fee, even if the charge reports the impossible", () => {
    expect(
      feeRefundAmount({ chargeAmount: 4000, chargeAmountRefunded: 5000, feeAmount: 60, feeAmountRefunded: 0 }),
    ).toBe(60);
  });
});
