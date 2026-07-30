import { describe, expect, it } from "vitest";
import {
  intervalKeyOf,
  nextChargeDate,
  paymentStatusKey,
  planState,
  sequenceKey,
} from "@/lib/billing-display";

const first = (status: string) => ({ sequenceType: "first", status });
const recurring = (status: string) => ({ sequenceType: "recurring", status });

describe("intervalKeyOf", () => {
  it("maps Mollie interval grammar back to a key", () => {
    expect(intervalKeyOf("1 month")).toBe("month");
    expect(intervalKeyOf("3 months")).toBe("quarter");
    expect(intervalKeyOf("12 months")).toBe("year");
  });
  it("falls back to month on an unknown interval", () => {
    expect(intervalKeyOf("2 weeks")).toBe("month");
  });
});

describe("planState (partner billing view / double-charge guard)", () => {
  it("returns 'none' with no subscription", () => {
    expect(planState(undefined, [])).toBe("none");
  });

  it("returns 'pay' for a PENDING plan with no paid first payment", () => {
    expect(planState({ status: "PENDING" }, [])).toBe("pay");
    expect(planState({ status: "PENDING" }, [first("open")])).toBe("pay");
  });

  it("returns 'processing' for PENDING once a first payment is PAID (mandate-lag window)", () => {
    // The trap: sub can read PENDING for ~80s..~26h after payment while the
    // webhook retries activation — must NOT offer to pay again.
    expect(planState({ status: "PENDING" }, [first("paid")])).toBe("processing");
  });

  it("returns 'processing' while ACTIVATING", () => {
    expect(planState({ status: "ACTIVATING" }, [first("paid")])).toBe("processing");
  });

  it("returns 'active' when ACTIVE", () => {
    expect(planState({ status: "ACTIVE" }, [first("paid"), recurring("paid")])).toBe("active");
  });

  it("returns 'inactive' for terminal states", () => {
    expect(planState({ status: "CANCELED" }, [])).toBe("inactive");
    expect(planState({ status: "SUSPENDED" }, [])).toBe("inactive");
  });
});

describe("sequenceKey", () => {
  it("maps Mollie's sequence vocabulary to owner-facing keys", () => {
    expect(sequenceKey("first")).toBe("first");
    expect(sequenceKey("recurring")).toBe("recurring");
    expect(sequenceKey("oneoff")).toBe("oneoff");
  });

  it("buckets anything unrecognised as recurring, never as `first`", () => {
    // `first` is the one value the payer reads as "this is the charge that started my
    // subscription". An unknown sequence type must not borrow that meaning.
    expect(sequenceKey("")).toBe("recurring");
    expect(sequenceKey("something-mollie-added")).toBe("recurring");
  });
});

describe("paymentStatusKey", () => {
  it("collapses the seven Mollie statuses into what a payer acts on", () => {
    expect(paymentStatusKey("paid")).toBe("paid");
    expect(paymentStatusKey("authorized")).toBe("paid");
    expect(paymentStatusKey("open")).toBe("pending");
    expect(paymentStatusKey("pending")).toBe("pending");
    expect(paymentStatusKey("failed")).toBe("failed");
    expect(paymentStatusKey("canceled")).toBe("failed");
    expect(paymentStatusKey("expired")).toBe("failed");
  });

  it("never promotes an unknown status to paid", () => {
    // A status Mollie adds later renders as its own literal text via the `other`
    // bucket. Reading it as "paid" would tell an owner money arrived when it did not.
    expect(paymentStatusKey("chargeback")).toBe("other");
    expect(paymentStatusKey("")).toBe("other");
  });
});

describe("nextChargeDate", () => {
  const NOW = new Date("2026-07-30T12:00:00Z");

  it("returns the first recurring charge while it is still ahead", () => {
    // Month one: `startDate` IS the next charge, and no stepping should happen.
    expect(nextChargeDate(new Date("2026-08-15T00:00:00Z"), "1 month", NOW)).toEqual(
      new Date("2026-08-15T00:00:00Z"),
    );
  });

  it("steps a stale anchor forward instead of reporting a date in the past", () => {
    // The defect this exists for: `startDate` is written once at activation and never
    // advanced, so from month two on it names a charge that already happened.
    const next = nextChargeDate(new Date("2026-01-15T00:00:00Z"), "1 month", NOW);
    expect(next).toEqual(new Date("2026-08-15T00:00:00Z"));
    expect(next!.getTime()).toBeGreaterThan(NOW.getTime());
  });

  it("keeps the subscription's own day of month rather than drifting to today", () => {
    // Stepping from `now` instead of from the anchor would answer "30 Aug" here.
    expect(nextChargeDate(new Date("2025-03-02T00:00:00Z"), "1 month", NOW)).toEqual(
      new Date("2026-08-02T00:00:00Z"),
    );
  });

  it("honours quarterly and yearly intervals", () => {
    expect(nextChargeDate(new Date("2026-01-15T00:00:00Z"), "3 months", NOW)).toEqual(
      new Date("2026-10-15T00:00:00Z"),
    );
    expect(nextChargeDate(new Date("2024-05-20T00:00:00Z"), "12 months", NOW)).toEqual(
      new Date("2027-05-20T00:00:00Z"),
    );
  });

  it("returns null rather than a guess when it cannot compute one", () => {
    // The caller falls back to a plain "Active." — better than inventing a date.
    expect(nextChargeDate(null, "1 month", NOW)).toBeNull();
    expect(nextChargeDate(new Date("nope"), "1 month", NOW)).toBeNull();
    expect(nextChargeDate(new Date("2026-01-15T00:00:00Z"), "2 weeks", NOW)).toBeNull();
  });

  it("advances past an anchor exactly equal to now", () => {
    // A charge due this instant is not the NEXT one — `<=` in the loop, not `<`.
    expect(nextChargeDate(NOW, "1 month", NOW)).toEqual(new Date("2026-08-30T12:00:00Z"));
  });
});
