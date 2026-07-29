// May a provisioning proposal be opened for this slug yet?
// (SOFRA-ONBOARDING-PLAN O2 — the abuse gate, and trap 7.)
//
// O2 lets a stranger create an account and a plan with no human involved. O3 will
// let a merge stand up real infrastructure. Coupling those two without a gate
// would mean anyone who can fill in a form can queue a database, a subdomain and
// a container for the founder to rubber-stamp. The plan says to keep the payment
// and the proposal coupled, and this is where that coupling is enforced:
//
//   a self-serve tenant gets a proposal only once its first payment has SETTLED.
//
// "Settled" is deliberately `paid`, not "a checkout was started". An `open`
// payment is a hosted-checkout URL nobody has completed — free to create, and
// therefore worth nothing as a gate.
//
// Founder-originated tenants are unaffected. A slug with no billing row at all is
// a founder proposing a tenant by hand (the reseller path defines the plan AFTER
// provisioning, and RUMI predates all of this), so an absent plan means "not
// self-serve" and the gate stays out of the way. That asymmetry is the point: the
// gate exists to stop unpaid SELF-SERVE plans reaching infrastructure, not to add
// a payment precondition to the founder's own tooling.
//
// Pure — no DB, no network — so the policy is unit-testable apart from the query
// that feeds it.

/** The billing facts the gate needs. `null` = no plan exists for this slug. */
export type SlugBillingFacts = {
  /** True when the plan's payer is a self-serve OWNER (`payerUserId` set), as
   *  opposed to a reseller plan derived from a CRM Client. */
  selfServe: boolean;
  /** True when a `first` payment on this billing row has reached `paid`. */
  firstPaymentSettled: boolean;
  /** True when the subscription is already ACTIVE — a settled first payment whose
   *  mandate has since validated. Kept separate because a plan can be ACTIVE with
   *  its first payment row pruned or re-created, and an active subscription is
   *  strictly stronger evidence of payment than the payment row is. */
  subscriptionActive: boolean;
};

export type ProvisionGateVerdict = "allowed" | "awaitingPayment";

/**
 * Decide whether a proposal may be opened.
 *
 * Fail-open cases, both deliberate:
 *   • no plan for this slug → the founder is proposing a tenant by hand.
 *   • the plan is not self-serve → the reseller flow, where the partner is
 *     invoiced after the tenant is live.
 *
 * Fail-closed case, the only one:
 *   • a self-serve plan with nothing paid → refuse.
 */
export function provisionGate(facts: SlugBillingFacts | null): ProvisionGateVerdict {
  if (!facts) return "allowed";
  if (!facts.selfServe) return "allowed";
  return facts.firstPaymentSettled || facts.subscriptionActive ? "allowed" : "awaitingPayment";
}
