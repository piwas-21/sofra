// Minting a tenant's Express connected account (ADR-011 amendment, slice E2).
//
// This is the code that replaces the founder's hand-run `curl` in
// docs/runbooks/signup-to-live-tenant.md §2b.1. It runs in the CONTROL PLANE and
// nowhere else: `provision-tenant.sh` keeps reading the registry as the source of
// truth (ADR-003/ADR-007) and needs no new capability, and the box key
// (STRIPE_PLATFORM_API_KEY) must never gain `Connect -> write` — a control plane
// that can mint connected accounts is a higher-value target than any box, and
// that is an argument for keeping the power in one place, not for spreading it.
//
// The whole file is orchestration. Both decisions worth testing live next door
// and are pure: the payload (lib/connect-account-request.ts) and the idempotency
// key (lib/connect-account-store.ts). What is left here is the ORDER, and the
// order is the safety property:
//
//   1. derive the idempotency key   -> refuses a non-registry slug, offline
//   2. build the form               -> refuses an unsupported country, offline
//   3. read our own row             -> a tenant already minted for is answered
//                                      without a network call, and stays answered
//                                      after Stripe's ~24h key window has closed
//   4. POST /v1/accounts            -> the only side effect
//   5. record the row               -> immediately, BEFORE any registry PR is
//                                      composed, because that is the window a
//                                      crash used to lose a live account in
//
// There is deliberately NO update path. Measured: `business_type`,
// `individual[...]`, `external_account[...]` and `email` are all refused on
// `POST /v1/accounts/{id}` with `403 oauth_not_supported`. Prefill is one-shot.

import {
  connectExpressIdempotencyKey,
  findConnectAccountForSlug,
  newOnboardingToken,
  recordConnectAccount,
} from "@/lib/connect-account-store";
import { expressAccountForm, type ExpressAccountInput } from "@/lib/connect-account-request";
import { onboardingLinkForm, type ConnectAccountState } from "@/lib/connect-account-links";
import { stripeGet, stripePost } from "@/lib/stripe";

/** The slice of Stripe's Account object this module reads. */
type StripeAccountCreated = { id: string };

export type MintedConnectAccount = {
  /** `acct_...` */
  stripeAccountId: string;
  /**
   * The unguessable segment of this tenant's `/onboarding/payments/<token>` page
   * (E4). Returned so the caller can put the finished URL in the registry entry
   * — the box never sees the token as a token, only a URL it copies.
   */
  onboardingToken: string;
  /**
   * True when the account already existed for this slug and no Stripe call was
   * made. Reported rather than hidden because the caller's audit line should say
   * which of the two happened — "minted" and "already had one" are different
   * facts about a live payment account.
   */
  reused: boolean;
};

export async function createExpressAccount(input: ExpressAccountInput): Promise<MintedConnectAccount> {
  const idempotencyKey = connectExpressIdempotencyKey(input.slug);
  const form = expressAccountForm(input);

  const existing = await findConnectAccountForSlug(input.slug);
  if (existing) {
    return {
      stripeAccountId: existing.stripeAccountId,
      onboardingToken: existing.onboardingToken,
      reused: true,
    };
  }

  const account = await stripePost<StripeAccountCreated>("/v1/accounts", form, { idempotencyKey });
  const onboardingToken = newOnboardingToken();

  // Not in a transaction with the call above, because there is no such thing: the
  // account exists at Stripe the moment it returns. What makes the gap survivable
  // is that the key is derived from the slug, so a replay recovers THIS account
  // rather than minting a second one (measured 2026-09-05, with a negative control).
  await recordConnectAccount({
    tenantSlug: input.slug,
    stripeAccountId: account.id,
    idempotencyKey,
    country: form.country,
    // Minted here, with the account, and never re-issued: it is how the restaurant
    // reaches its own onboarding page for as long as that page exists.
    onboardingToken,
  });

  return { stripeAccountId: account.id, onboardingToken, reused: false };
}

/** Stripe's `AccountLink` / `LoginLink` — both are `{ url }` and nothing else is read. */
type StripeLink = { url: string };

/**
 * A FRESH onboarding link. Never cached, never stored, never emailed: it lives
 * 300 seconds (measured), so any copy of it is a dead link by the time a person
 * reads it. That is why the restaurant is given a page of OURS instead.
 */
export function createOnboardingLink(accountId: string, pageUrl: string): Promise<StripeLink> {
  return stripePost<StripeLink>("/v1/account_links", onboardingLinkForm(accountId, pageUrl));
}

/**
 * The Express dashboard login link, for an account that has finished onboarding.
 * Refused (400) before that, which is why `chooseConnectLink` decides first.
 */
export function createLoginLink(accountId: string): Promise<StripeLink> {
  return stripePost<StripeLink>(`/v1/accounts/${accountId}/login_links`, {});
}

/** Read an account's onboarding state. The 5-minute-cached tenant-side reader in
 *  the backend is unchanged; this is the control plane's own, per request. */
export function readConnectAccount(accountId: string): Promise<ConnectAccountState> {
  return stripeGet<ConnectAccountState>(`/v1/accounts/${accountId}`);
}
