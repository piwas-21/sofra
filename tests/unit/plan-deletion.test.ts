import { describe, expect, it } from "vitest";
import { planDeletionVerdict, settledOrInFlight, type PlanDeletionFacts } from "@/lib/plan-deletion";

const facts = (over: Partial<PlanDeletionFacts> = {}): PlanDeletionFacts => ({
  invoiceCount: 0,
  liveOrSettledPaymentCount: 0,
  liveSubscriptionCount: 0,
  hasMollieCustomer: false,
  ...over,
});

describe("planDeletionVerdict — what must survive an operator tidying up", () => {
  it("allows a plan that never charged and never invoiced", () => {
    // The case this exists for: an abandoned test plan.
    expect(planDeletionVerdict(facts())).toEqual({ deletable: true, warnings: [] });
  });

  it("REFUSES when an invoice names this tenant", () => {
    // Nothing in the database stops this: `Invoice` links to a tenant by the
    // tenantSlug STRING, not a foreign key (the registry is not a table,
    // ADR-007), so Postgres would delete the plan and leave the invoice
    // addressed to a tenant that no longer exists.
    expect(planDeletionVerdict(facts({ invoiceCount: 1 }))).toEqual({
      deletable: false,
      blocker: "hasInvoices",
    });
  });

  it("REFUSES when money settled — the payment row IS the audit trail", () => {
    // BillingPayment cascades from the plan, so deleting one destroys the record
    // of money that actually moved.
    expect(planDeletionVerdict(facts({ liveOrSettledPaymentCount: 1 }))).toEqual({
      deletable: false,
      blocker: "hasPaidPayments",
    });
  });

  it("REFUSES while a subscription can still be charged", () => {
    // The worst of the three: Mollie would keep billing a customer this system
    // no longer knows, and nothing would report it.
    expect(planDeletionVerdict(facts({ liveSubscriptionCount: 1 }))).toEqual({
      deletable: false,
      blocker: "hasLiveSubscription",
    });
  });

  it("reports the INVOICE blocker first when several apply", () => {
    // Order matters for the message the operator reads: the legal record is the
    // one they cannot resolve by cancelling something.
    expect(
      planDeletionVerdict(
        facts({ invoiceCount: 1, liveOrSettledPaymentCount: 3, liveSubscriptionCount: 2 }),
      ),
    ).toMatchObject({ blocker: "hasInvoices" });
  });

  it("warns about an orphaned Mollie customer rather than refusing", () => {
    // A customer created for a plan that never charged has no mandate and no
    // subscription, so it is harmless — but it outlives the row that named it,
    // and the operator should hear that from us rather than find it later.
    expect(planDeletionVerdict(facts({ hasMollieCustomer: true }))).toEqual({
      deletable: true,
      warnings: ["orphanMollieCustomer"],
    });
  });

  it("does not warn when there was never a Mollie customer", () => {
    expect(planDeletionVerdict(facts()).deletable && planDeletionVerdict(facts())).toEqual({
      deletable: true,
      warnings: [],
    });
  });

  it("treats a dead checkout as no obstacle", () => {
    // An expired or failed checkout is exactly what an abandoned test leaves
    // behind; refusing on it would make the feature useless for its one purpose.
    expect(planDeletionVerdict(facts({ liveOrSettledPaymentCount: 0 })).deletable).toBe(true);
  });
});

describe("settledOrInFlight — which Mollie statuses still stand between us and a delete", () => {
  it("treats only the three terminal statuses as dead", () => {
    for (const dead of ["failed", "canceled", "expired"]) {
      expect(settledOrInFlight(dead), dead).toBe(false);
    }
  });

  it("blocks on money that has NOT settled yet", () => {
    // The costly case: after a delete, recordPayment finds no plan and returns
    // silently with a 200, so a bank transfer settling next Tuesday arrives with
    // no payment row, no invoice and no notification. `authorized` is money
    // committed awaiting capture; `pending`/`open` are the slow methods.
    for (const live of ["paid", "authorized", "pending", "open"]) {
      expect(settledOrInFlight(live), live).toBe(true);
    }
  });

  it("treats an UNKNOWN status as live, not dead", () => {
    // The list of terminal statuses is the safe one to hardcode: an allow-list of
    // live ones would silently let a status Mollie adds next year through, and
    // that is the direction that loses a payment.
    expect(settledOrInFlight("some_status_mollie_adds_in_2030")).toBe(true);
  });
});
