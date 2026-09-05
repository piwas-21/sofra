// WHICH Stripe link a restaurant should be sent to, and what to ask Stripe for
// (ADR-011 amendment, slice E4). Pure: no network, no env, no clock.
//
// There are two links, not one, and the choice is not cosmetic — MEASURED
// 2026-09-05 on a fresh CH Express account (deleted afterwards; GET -> 403):
//
//   POST /v1/account_links type=account_onboarding -> 200, and
//        `expires_at - created` = 300 SECONDS. Two calls return two DIFFERENT
//        urls, so a link is a one-shot handle, never a stored address.
//   POST /v1/accounts/{id}/login_links            -> 400 "Cannot create a login
//        link for an account that has not completed onboarding."
//   POST /v1/account_links type=account_update    -> 400 "You cannot create
//        `account_update` type Account Links for this account. Valid types for
//        this account are ["account_onboarding"]."
//
// So: before onboarding, only an onboarding link exists; after it, only a login
// link does; and `account_update` — the obvious "let them edit their details"
// choice — does not exist on Express at all. Sending the wrong one is a 400 in
// the restaurant's face at the exact moment they are trying to get paid.

/** What Stripe reports about an account, reduced to the fields that decide. */
export type ConnectAccountState = {
  /** True once the restaurant has finished Stripe's hosted form. */
  details_submitted?: boolean;
};

export type ConnectLinkKind = "onboarding" | "login";

/**
 * `details_submitted` and nothing else.
 *
 * NOT `charges_enabled`: an account can have submitted everything and still be
 * under review, and in that window `charges_enabled` is false while the
 * onboarding link is refused — asking for the onboarding link there would show a
 * restaurant a form it has already filled in. `details_submitted` is precisely
 * the fact the login-link refusal is worded against ("has not completed
 * onboarding").
 */
export function chooseConnectLink(account: ConnectAccountState): ConnectLinkKind {
  return account.details_submitted === true ? "login" : "onboarding";
}

/**
 * The `POST /v1/account_links` form.
 *
 * Both URLs point back at OUR page, and both are the same URL on purpose:
 *
 *  - `refresh_url` is where Stripe sends the restaurant when the link has died —
 *    it lasts 300 seconds, so this is an ordinary event, not an error. Our page
 *    mints a fresh link on every request, so landing back on it simply continues
 *    the journey. Anything else here (an error page, the marketing site) would
 *    strand someone mid-KYC for having taken a phone call.
 *  - `return_url` is where they land when they are done. The same page then
 *    chooses the LOGIN link instead (see `chooseConnectLink`), which is what a
 *    finished restaurant should get.
 */
export function onboardingLinkForm(accountId: string, pageUrl: string): Record<string, string> {
  return {
    account: accountId,
    type: "account_onboarding",
    refresh_url: pageUrl,
    return_url: pageUrl,
  };
}
