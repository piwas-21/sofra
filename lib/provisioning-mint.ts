// The mint, placed where a registry proposal is composed (ADR-011 amendment, E3).
//
// This is the provenance flip. Until now `stripe_account:` could only come from a
// founder typing an `acct_` they had created by hand with `curl`, because of a
// premise written into five files: "only the restaurant can create one, through
// Stripe's hosted onboarding, which cannot be pre-filled". MEASURED 2026-09-05,
// that premise is false in the direction that matters — prefill is refused on
// UPDATE (403 `oauth_not_supported`) and works on CREATE. So the platform mints
// the account, and the entry carries `online-payments` AND `stripe_account:` in
// ONE commit, which is exactly what `provision-tenant.sh:117` asks for.
//
// THREE RULES, and each is here rather than in the callers because both callers
// need all three:
//
//  1. **It never throws.** The self-serve caller is reached from the Mollie
//     webhook, where an exception means a non-2xx, which means Mollie redelivers
//     a paid customer's activation for ~26h. Every failure becomes a `note`.
//  2. **A failure does not cancel the tenant.** A restaurant whose Stripe account
//     could not be minted still gets its restaurant — provisioned without
//     `online-payments`, trading on cash, exactly as before this slice. The
//     module is then withheld by the pairing rule rather than proposed into an
//     entry `provision-tenant.sh` would refuse *before the database*, i.e. into
//     no tenant at all. That guard stays the last-resort assertion and stays
//     satisfiable; what changes is that it now essentially never fires.
//  3. **It mints only what was bought.** No `online-payments` in the modules, no
//     account: a live Stripe account for a restaurant that never asked for card
//     payments is a real object with a real compliance obligation attached.

import { createExpressAccount } from "@/lib/stripe-connect-accounts";
import { connectCountryForCurrency } from "@/lib/connect-account-country";
import { isStripeAccountId } from "@/lib/validation-provision";
import { stripeConfigured } from "@/lib/stripe";
import { ACCOUNT_PAIRED_MODULE_IDS } from "@/lib/provisioning-module-pairing";

export type MintForProposalInput = {
  slug: string;
  name: string;
  adminEmail: string;
  currency: string;
  modules: string[];
  /** The tenant's own hostname — `business_profile[url]`. */
  url: string;
};

export type MintForProposalResult = {
  /** The minted (or already-recorded) `acct_…`, when there is one. */
  stripeAccount?: string;
  /**
   * Why there is none — founder-facing, and written into the PR body. Absent when
   * nothing was attempted (the tenant did not buy the module) or when it worked.
   */
  note?: string;
};

/**
 * Mint this tenant's connected account, if the proposal needs one.
 *
 * Returns `{}` when the tenant bought no account-paired module — the ordinary case
 * for most entries, and not a failure to report.
 */
export async function mintForProposal(input: MintForProposalInput): Promise<MintForProposalResult> {
  const buysPaired = input.modules.some((id) => (ACCOUNT_PAIRED_MODULE_IDS as readonly string[]).includes(id));
  if (!buysPaired) return {};

  if (!stripeConfigured()) {
    return { note: "STRIPE_API_KEY is not configured in the control plane, so no account could be created" };
  }

  const country = connectCountryForCurrency(input.currency);
  if (!country.ok) return { note: country.reason };

  try {
    const minted = await createExpressAccount({
      slug: input.slug,
      country: country.country,
      email: input.adminEmail,
      name: input.name,
      url: input.url,
    });
    // The grammar check that used to guard a founder's typing, now applied to what
    // Stripe returned: this value reaches the tenant's Stripe env, where a wrong
    // string means charges addressed to an account that does not exist. It has
    // never once failed here — which is the point of asserting it.
    if (!isStripeAccountId(minted.stripeAccountId)) {
      return { note: `Stripe returned an account id in an unexpected shape and it was not recorded in the entry` };
    }
    return { stripeAccount: minted.stripeAccountId };
  } catch (e) {
    // No PII: a slug and Stripe's own message (CLAUDE.md §5.8).
    console.error("mintForProposal failed", input.slug, e);
    const detail = e instanceof Error ? e.message : "unknown error";
    return { note: `creating the Stripe connected account failed — ${detail}` };
  }
}
