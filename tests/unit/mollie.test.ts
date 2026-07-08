import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { MollieError, mollieConfigured, toAmount } from "@/lib/mollie";

// These tests NEVER hit the network — only the pure helpers + env gate.
// The Mollie key is LIVE in prod; the client's fetch paths are deliberately
// out of unit scope (they belong to the e2e/manual billing checks).

describe("toAmount (integer cents → Mollie amount object)", () => {
  it("formats whole euros to two decimals", () => {
    expect(toAmount(12900)).toEqual({ currency: "EUR", value: "129.00" });
  });

  it("formats sub-euro cents", () => {
    expect(toAmount(5)).toEqual({ currency: "EUR", value: "0.05" });
  });

  it("formats zero", () => {
    expect(toAmount(0)).toEqual({ currency: "EUR", value: "0.00" });
  });

  it("keeps exactly two decimals for round amounts", () => {
    expect(toAmount(100000)).toEqual({ currency: "EUR", value: "1000.00" });
  });

  it("honours a non-default currency", () => {
    expect(toAmount(2500, "CHF")).toEqual({ currency: "CHF", value: "25.00" });
  });
});

describe("MollieError", () => {
  it("carries status + detail and a composed message", () => {
    const err = new MollieError(422, "Amount is too low");
    expect(err).toBeInstanceOf(Error);
    expect(err.status).toBe(422);
    expect(err.detail).toBe("Amount is too low");
    expect(err.message).toBe("Mollie 422: Amount is too low");
  });
});

describe("mollieConfigured (env gate)", () => {
  const original = process.env.MOLLIE_API_KEY;
  beforeEach(() => {
    delete process.env.MOLLIE_API_KEY;
  });
  afterEach(() => {
    if (original === undefined) delete process.env.MOLLIE_API_KEY;
    else process.env.MOLLIE_API_KEY = original;
  });

  it("is false when the key is unset", () => {
    expect(mollieConfigured()).toBe(false);
  });

  it("is false when the key is empty", () => {
    process.env.MOLLIE_API_KEY = "";
    expect(mollieConfigured()).toBe(false);
  });

  it("is true when a key is present", () => {
    process.env.MOLLIE_API_KEY = "test_dummy";
    expect(mollieConfigured()).toBe(true);
  });
});
