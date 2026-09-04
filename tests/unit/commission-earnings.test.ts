import { describe, expect, it } from "vitest";
import {
  commissionEarnings,
  unmappedFeeAccounts,
  type FeeMovement,
} from "@/lib/commission-earnings";

const FROM = new Date("2026-08-01T00:00:00.000Z");
const TO = new Date("2026-10-01T00:00:00.000Z");
const AT = new Date("2026-09-04T21:45:59.000Z");

const fee = (over: Partial<FeeMovement> = {}): FeeMovement => ({
  amount: 60,
  currency: "chf",
  at: AT,
  chargeId: "ch_1",
  ...over,
});

const ready = (over: Partial<Parameters<typeof commissionEarnings>[0]> = {}) =>
  commissionEarnings({
    registryReadable: true,
    stripeAccount: "acct_1UC065FfnKu8VnLM",
    earned: [],
    refunded: [],
    from: FROM,
    to: TO,
    ...over,
  });

describe("commissionEarnings — fail quiet", () => {
  it("an unreadable registry reports a reason and NO number", () => {
    // The assertion that matters: not merely that `kind` is "unavailable", but
    // that the returned object carries no numeric total at all. That is what
    // stops a later refactor from degrading our own outage into a "0" printed
    // beside a tenant's name.
    const result = ready({ registryReadable: false });
    expect(result).toEqual({ kind: "unavailable", reason: "registryUnavailable" });
    expect(JSON.stringify(result)).not.toMatch(/\d/);
  });

  it("registry readable but no stripe_account is a DIFFERENT reason", () => {
    // The common case today, and not a defect: no tenant carries an account yet.
    expect(ready({ stripeAccount: undefined })).toEqual({
      kind: "unavailable",
      reason: "noStripeAccount",
    });
  });

  it("a whitespace-only account is not an account", () => {
    // The box tests `-z`, which " " passes — the same trap
    // `missingPairedStripeAccount` exists to close.
    expect(ready({ stripeAccount: "   " })).toEqual({
      kind: "unavailable",
      reason: "noStripeAccount",
    });
  });

  it("an account with no rows is READY and empty, not unavailable", () => {
    // "We are watching this account and it collected nothing" is a fact.
    // "We cannot see this account" is not. They must not render the same.
    expect(ready()).toEqual({ kind: "ready", totals: [], unmatchedRefundCount: 0 });
  });
});

describe("commissionEarnings — the net", () => {
  it("nets a fully refunded fee to zero and still reports the tenant", () => {
    const result = ready({ earned: [fee()], refunded: [fee()] });
    expect(result).toMatchObject({ kind: "ready", unmatchedRefundCount: 0 });
    expect(result.kind === "ready" && result.totals[0]).toMatchObject({
      currency: "chf",
      earnedMinor: 60,
      refundedMinor: 60,
      netMinor: 0,
      feeCount: 1,
      refundCount: 1,
    });
  });

  it("goes NEGATIVE for a refund whose fee predates fee recording, and says how many", () => {
    // Real on day one, not hypothetical: staging already holds two
    // StripeFeeRefund rows written by the fee-refund runbook, and zero
    // StripeApplicationFee rows for them — that table did not exist yet. A
    // `Math.max(0, …)` "tidy-up" makes this 0 and hides the pre-history in the
    // one direction that costs money.
    const result = ready({ earned: [], refunded: [fee({ amount: 30 })] });
    expect(result).toMatchObject({ kind: "ready", unmatchedRefundCount: 1 });
    expect(result.kind === "ready" && result.totals[0].netMinor).toBe(-30);
  });

  it("two incremental partial refunds against one fee net to zero and are MATCHED", () => {
    // The shape the runbook actually measured: 60 returned as 30 + 30.
    const result = ready({
      earned: [fee({ amount: 60 })],
      refunded: [fee({ amount: 30 }), fee({ amount: 30 })],
    });
    expect(result).toMatchObject({ kind: "ready", unmatchedRefundCount: 0 });
    expect(result.kind === "ready" && result.totals[0]).toMatchObject({
      netMinor: 0,
      refundCount: 2,
    });
  });
});

describe("commissionEarnings — the window is half-open", () => {
  // Loosening a boundary is silent; this pair is the control on it.
  it("a movement exactly at `from` is IN", () => {
    const result = ready({ earned: [fee({ at: FROM })] });
    expect(result.kind === "ready" && result.totals[0].feeCount).toBe(1);
  });

  it("a movement exactly at `to` is OUT", () => {
    expect(ready({ earned: [fee({ at: TO })] })).toEqual({
      kind: "ready",
      totals: [],
      unmatchedRefundCount: 0,
    });
  });

  it("a refund outside the window is neither counted nor called unmatched", () => {
    const result = ready({ refunded: [fee({ at: new Date("2026-07-31T23:59:59.999Z") })] });
    expect(result).toEqual({ kind: "ready", totals: [], unmatchedRefundCount: 0 });
  });
});

describe("commissionEarnings — currencies are never summed", () => {
  it("keeps a CHF fee and a EUR fee apart", () => {
    const result = ready({
      earned: [fee({ amount: 60, currency: "chf" }), fee({ amount: 40, currency: "eur" })],
    });
    expect(result.kind === "ready" && result.totals).toHaveLength(2);
    // 100 is the number a single mixed total would print, under one symbol.
    expect(
      result.kind === "ready" && result.totals.some((t) => t.earnedMinor === 100),
    ).toBe(false);
  });

  it("a EUR refund does not reduce the CHF net — it gets its own row", () => {
    const result = ready({
      earned: [fee({ amount: 60, currency: "chf" })],
      refunded: [fee({ amount: 30, currency: "eur", chargeId: "ch_2" })],
    });
    expect(result.kind === "ready" && result.totals).toEqual([
      {
        currency: "chf",
        earnedMinor: 60,
        refundedMinor: 0,
        netMinor: 60,
        feeCount: 1,
        refundCount: 0,
      },
      {
        currency: "eur",
        earnedMinor: 0,
        refundedMinor: 30,
        netMinor: -30,
        feeCount: 0,
        refundCount: 1,
      },
    ]);
  });

  it("'CHF' and 'chf' in one window collapse to a single total", () => {
    // What stops someone deleting the lower-casing in `feeEarnedRow`.
    const result = ready({
      earned: [fee({ amount: 60, currency: "CHF" }), fee({ amount: 40, currency: "chf" })],
    });
    expect(result.kind === "ready" && result.totals).toHaveLength(1);
    expect(result.kind === "ready" && result.totals[0]).toMatchObject({
      currency: "chf",
      earnedMinor: 100,
    });
  });
});

describe("unmappedFeeAccounts", () => {
  it("says nothing when the registry names the account", () => {
    expect(unmappedFeeAccounts(["acct_A"], ["acct_A"])).toEqual([]);
  });

  it("names an account with real revenue that no registry entry claims", () => {
    // The discriminating case: fees exist, and they appear on nobody's page.
    expect(unmappedFeeAccounts(["acct_A"], ["acct_B"])).toEqual(["acct_A"]);
  });

  it("treats a whitespace-only registry value as no account at all", () => {
    expect(unmappedFeeAccounts(["acct_A"], ["   ", undefined])).toEqual(["acct_A"]);
  });

  it("is CASE-SENSITIVE — Stripe ids are, unlike currency codes", () => {
    expect(unmappedFeeAccounts(["acct_A"], ["Acct_A"])).toEqual(["acct_A"]);
  });

  it("reports each unmapped account once", () => {
    expect(unmappedFeeAccounts(["acct_A", "acct_A", "acct_B"], [])).toEqual(["acct_A", "acct_B"]);
  });
});
