// What `/onboarding/payments/<token>` should do with one request (E4).
//
// The restaurant's whole journey into Stripe runs through this: a welcome mail
// and the tenant's own Payments tab both point at that page, never at a Stripe
// URL, because an Account Link lives 300 SECONDS (measured) and is dead before
// most people finish reading an email.
//
// Every branch is a decision about a person mid-onboarding, so none of them may
// throw and none may be vague:
//
//  - unknown token          -> 404, and the SAME 404 for a row that predates
//                              tokens. Telling them apart would confirm to a
//                              stranger that a token is nearly right.
//  - onboarding unfinished  -> a FRESH onboarding link, every single request.
//                              This is also the `refresh_url` landing, i.e. the
//                              restaurant took a phone call and their link
//                              expired — the ordinary case, not an error.
//  - onboarding finished    -> the Express dashboard LOGIN link instead. Asking
//                              for an onboarding link there shows someone a form
//                              they already filled in; `account_update` links do
//                              not exist on Express at all (400, measured).
//  - Stripe unreachable     -> say so plainly and let them retry. Never a blank
//                              page, and never a Stripe error string.

import { findConnectAccountByToken } from "@/lib/connect-account-store";
import { chooseConnectLink } from "@/lib/connect-account-links";
import {
  createLoginLink,
  createOnboardingLink,
  readConnectAccount,
} from "@/lib/stripe-connect-accounts";
import { stripeConfigured } from "@/lib/stripe";

export type PaymentsLinkOutcome =
  | { kind: "redirect"; url: string }
  | { kind: "unknownToken" }
  | { kind: "unavailable" };

/**
 * @param token the URL segment, exactly as received.
 * @param pageUrl this page's own absolute URL — handed in rather than derived
 *   here, because it becomes Stripe's `refresh_url`/`return_url` and a wrong
 *   origin would send a restaurant somewhere that does not exist. The route
 *   builds it from the request it actually received.
 */
export async function resolvePaymentsLink(token: string, pageUrl: string): Promise<PaymentsLinkOutcome> {
  // The two failures are NOT the same answer, and collapsing them is the exact
  // fail-quiet this repo keeps catching: a database outage would otherwise tell a
  // restaurant "this link is not one we recognise" — a confident falsehood about
  // their own link, sending them to hunt for a better one that does not exist —
  // when the truthful sentence is "we could not reach it, try again in a minute".
  let account;
  try {
    account = await findConnectAccountByToken(token);
  } catch (e) {
    console.error("resolvePaymentsLink could not read the token", e);
    return { kind: "unavailable" };
  }
  if (!account) return { kind: "unknownToken" };
  if (!stripeConfigured()) return { kind: "unavailable" };

  try {
    const state = await readConnectAccount(account.stripeAccountId);
    if (chooseConnectLink(state) === "login") {
      const login = await createLoginLink(account.stripeAccountId);
      return { kind: "redirect", url: login.url };
    }
    const link = await createOnboardingLink(account.stripeAccountId, pageUrl);
    return { kind: "redirect", url: link.url };
  } catch (e) {
    // No PII, and no Stripe wording passed to the visitor: they are a restaurant
    // owner, not an operator, and "No such account" would be alarming and useless.
    console.error("resolvePaymentsLink failed", account.tenantSlug, e);
    return { kind: "unavailable" };
  }
}
