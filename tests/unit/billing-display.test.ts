import { describe, expect, it } from "vitest";
import { intervalKeyOf, planState } from "@/lib/billing-display";

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
