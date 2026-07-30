import { describe, expect, it } from "vitest";
import { provisionGate, type SlugBillingFacts } from "@/lib/provisioning-payment-gate";

const facts = (over: Partial<SlugBillingFacts> = {}): SlugBillingFacts => ({
  selfServe: true,
  firstPaymentSettled: false,
  subscriptionActive: false,
  ...over,
});

describe("provisionGate", () => {
  it("refuses a self-serve plan with nothing paid — the whole point of the gate", () => {
    expect(provisionGate(facts())).toBe("awaitingPayment");
  });

  it("allows a self-serve plan once the first payment has settled", () => {
    expect(provisionGate(facts({ firstPaymentSettled: true }))).toBe("allowed");
  });

  it("allows a self-serve plan whose subscription is already ACTIVE", () => {
    // Stronger evidence of payment than the payment row: a subscription only goes
    // ACTIVE after a settled first payment validated the mandate. Accepted on its
    // own so a re-provision cannot be blocked by a pruned payment row.
    expect(provisionGate(facts({ subscriptionActive: true }))).toBe("allowed");
  });

  it("does not gate a founder-proposed tenant (no plan at all)", () => {
    // RUMI and every hand-proposed tenant land here. Gating this would add a
    // payment precondition to the founder's own tooling, which is not the job.
    expect(provisionGate(null)).toBe("allowed");
  });

  it("does not gate a reseller plan, which is invoiced after the tenant is live", () => {
    expect(provisionGate(facts({ selfServe: false }))).toBe("allowed");
  });

  it("still allows an unpaid reseller plan — selfServe is the discriminator", () => {
    expect(
      provisionGate(facts({ selfServe: false, firstPaymentSettled: false })),
    ).toBe("allowed");
  });
});
