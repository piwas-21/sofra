// The pre-grant window for the online-payments module (SOFRA-PAYMENTS-PLAN §9 P4).
//
// sofra knows what was BOUGHT; RUMI knows what is RUNNING (§9 Q4). The purchase lives
// on `SignupRequest.modules`, the grant lives in the deploy repo's registry entry, and
// the gap between the two IS the window this predicate names. Only sofra can see both
// sides of it, which is why the card belongs here and not on the tenant's own admin.
//
// P1 is what makes the window survivable rather than fatal: the buyer is provisioned
// WITHOUT the module and goes live on everything else, because `provision-tenant.sh`
// refuses `online-payments` without a `stripe_account:` and refuses it before the
// database. So the tenant is trading the whole time — on cash — and the only
// outstanding work is their own Stripe onboarding.

import { splitDeferredModules } from "./provisioning-registry";

/**
 * Which of these ids are account-paired — i.e. can be bought and not yet granted.
 *
 * Asked of `splitDeferredModules` with no account rather than restated as a literal:
 * that function is the one place that knows the pairing rule, and a second list here
 * would drift the day there is a second paired module. Same reason as
 * `missingPairedStripeAccount` in `tenant-registry.ts`.
 */
const pairedIn = (modules: string[]): string[] => splitDeferredModules(modules).deferred;

/**
 * Whether this plan bought online payments and has not been granted them yet.
 *
 * @param purchased `SignupRequest.modules` — the CSV grammar the registry and
 *   `provision-tenant.sh` already speak. Null for a founder-created plan, which has no
 *   lead and therefore no record of a purchase: nothing is claimed, so nothing is shown.
 * @param granted The registry entry's `modules`, or `undefined` when this slug has no
 *   entry yet.
 * @param registryReadable False when the registry could not be read at all.
 *
 * The registry-unreadable case is the one worth spelling out. An unreadable registry
 * looks EXACTLY like "no entry, so not granted" if you only pass a list — and it is our
 * ops failure, not the customer's, so inventing a "we are still switching this on"
 * message out of it would tell a live tenant their card payments are pending when they
 * have been taking cards for a month. Unknown means silent; the same fail-quiet
 * direction `registryDomains` already takes for the readiness panel.
 */
export function isPaymentsPending(args: {
  purchased: string | null | undefined;
  granted: readonly string[] | undefined;
  registryReadable: boolean;
}): boolean {
  const purchased = (args.purchased ?? "")
    .split(",")
    .map((m) => m.trim())
    .filter(Boolean);
  if (pairedIn(purchased).length === 0) return false;
  if (!args.registryReadable) return false;
  return pairedIn([...(args.granted ?? [])]).length === 0;
}
