// The account-pairing rule for ADR-012 registry entries: which fields must travel
// together with a tenant's Stripe connected account, and are withheld from an
// entry that does not have one yet.
//
// Split out of lib/provisioning-registry.ts (SOFRA-PAYMENTS-PRICING-MODE-PLAN S1)
// when a second paired field (`payments_commission_bps`) pushed that file over
// CLAUDE.md §4's LOC limit — the same split that file's own history records having
// had before, for provisioning-pr-body.ts/provisioning-pr-blocks.ts. This is the
// one purely-relational piece of the entry builder; everything left in
// provisioning-registry.ts is YAML shaping. `splitDeferredModules` is re-exported
// from there so no existing importer needed to change.

import type { ModuleId } from "./module-catalog";

/**
 * Modules `provision-tenant.sh` refuses unless the SAME entry also records a
 * `stripe_account:`. That guard `exit 1`s *before* the database, the compose project
 * and the image, so proposing the module without the account does not yield a tenant
 * lacking card payment — it yields no tenant at all.
 *
 * Hence the pairing rule below: the module ships only alongside an account, never on
 * its own. Which half is missing depends on the path in, and BOTH paths reach this one
 * generator:
 *
 * - **Self-serve.** The buyer has no `acct_` and cannot be given one — only the
 *   restaurant can create it, through Stripe's hosted onboarding, which cannot be
 *   pre-filled (`oauth_not_supported` on a Standard account, SOFRA-PAYMENTS-PLAN §3).
 *   So the module is deferred to a second registry PR and the PR body says so.
 * - **Founder.** `docs/runbooks/signup-to-live-tenant.md` §2b has the founder create
 *   the account BEFORE proposing, precisely because of this guard — so they arrive
 *   holding the `acct_`, and the entry carries both halves in one shot.
 *
 * Deferring unconditionally would have been wrong for the second path: it would make
 * the founder's documented order pointless and tell them, falsely, that no account can
 * exist yet.
 */
const ACCOUNT_PAIRED_MODULE_IDS: readonly ModuleId[] = ["online-payments"];

/**
 * Split a purchased module list into what this entry may carry now and what must wait
 * for a second registry PR. Pure and shared, so the entry and the PR body describing it
 * cannot disagree about which is which.
 *
 * `stripeAccount` is the whole hinge: with one, nothing is deferred; without one, the
 * account-paired ids are held back.
 */
export function splitDeferredModules(
  modules: string[],
  stripeAccount?: string,
): { granted: string[]; deferred: string[] } {
  // Whitespace-only is not an account: `provision-tenant.sh` tests `-z`, which a blank
  // string passes and " " does not — so a stray space would sail past the guard here and
  // then fail on the box, which is the one place this must never be discovered.
  if (stripeAccount?.trim()) return { granted: modules, deferred: [] };
  const isPaired = (id: string) => (ACCOUNT_PAIRED_MODULE_IDS as readonly string[]).includes(id);
  return {
    granted: modules.filter((id) => !isPaired(id)),
    deferred: modules.filter(isPaired),
  };
}

/**
 * Whether a requested commission rate belongs in a registry entry, and what to
 * write if so (SOFRA-PAYMENTS-PRICING-MODE-PLAN S1) — the SAME pairing rule as
 * `splitDeferredModules`, one field over: `provision-tenant.sh` refuses a
 * non-zero `payments_commission_bps` unless the SAME entry also carries
 * `online-payments` in `modules` AND a `stripe_account`. So the rate is only
 * ever emitted when `online-payments` itself survived the split above into
 * `granted` — writing it against a DEFERRED module would just move that exact
 * refusal onto this field instead of preventing it.
 *
 * Returns `undefined` — meaning "omit the key" — for two different reasons a
 * caller must not conflate: there is genuinely no rate (`0`/absent, which is
 * every entry before this field existed), or a rate WAS requested but
 * `online-payments` is deferred. The founder-facing explanation of both
 * branches lives in `lib/provisioning-pr-blocks.ts`'s `commissionSection`,
 * which takes the same two facts so the entry and the PR body describing it
 * cannot disagree.
 *
 * @param bps The requested rate, or `undefined`/`0` for none.
 * @param granted The entry's `modules` AFTER the split above — i.e. what
 *   `splitDeferredModules(...).granted` returned, not the raw purchase list.
 */
export function grantedCommissionBps(
  bps: number | undefined,
  granted: readonly string[],
): number | undefined {
  return (bps ?? 0) > 0 && granted.includes("online-payments") ? bps : undefined;
}
