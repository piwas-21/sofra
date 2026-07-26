import { describe, expect, it } from "vitest";
import { CHECKOUT_REUSE_WINDOW_MS, isCheckoutFresh } from "@/lib/checkout-window";

// The rule the reuse-an-open-checkout branch of startFirstPayment depends on.
describe("isCheckoutFresh", () => {
  const now = new Date("2026-07-26T12:00:00Z");
  const ago = (ms: number) => new Date(now.getTime() - ms);

  it("reuses a checkout created moments ago", () => {
    expect(isCheckoutFresh(now, now)).toBe(true);
    expect(isCheckoutFresh(ago(60_000), now)).toBe(true);
  });

  it("stops reusing before Mollie's ~60 minute expiry", () => {
    // The margin is the point: handing out a URL at minute 59 leaves the payer
    // a minute to finish, which is not a checkout, it is a trap.
    expect(CHECKOUT_REUSE_WINDOW_MS).toBeLessThan(60 * 60 * 1000);
    expect(isCheckoutFresh(ago(CHECKOUT_REUSE_WINDOW_MS - 1), now)).toBe(true);
    expect(isCheckoutFresh(ago(CHECKOUT_REUSE_WINDOW_MS), now)).toBe(false);
    expect(isCheckoutFresh(ago(2 * 60 * 60 * 1000), now)).toBe(false);
  });

  it("treats a future timestamp as fresh rather than expired", () => {
    // Clock skew between the app and the database should not make a
    // just-created checkout look stale.
    expect(isCheckoutFresh(new Date(now.getTime() + 5_000), now)).toBe(true);
  });
});
