import { describe, expect, it } from "vitest";
import { chooseConnectLink, onboardingLinkForm, paymentsPageUrl } from "@/lib/connect-account-links";
import { newOnboardingToken } from "@/lib/connect-account-store";
import { resolvePaymentsLink } from "@/lib/onboarding-payments";

// MEASURED 2026-09-05 on a fresh CH Express account (test mode, deleted after,
// GET -> 403). These are the numbers the module is written against:
//   account_links (account_onboarding) -> 200, expires_at - created = 300s,
//     and two calls return two DIFFERENT urls
//   login_links   -> 400 "Cannot create a login link for an account that has not
//     completed onboarding."
//   account_links type=account_update -> 400 'Valid types for this account are
//     ["account_onboarding"]'

describe("chooseConnectLink", () => {
  it("sends an unfinished account to onboarding", () => {
    // A fresh Express account reports details_submitted: false (measured), and a
    // login link for it is a 400 in the restaurant's face.
    expect(chooseConnectLink({ details_submitted: false })).toBe("onboarding");
  });

  it("sends a finished account to its Express dashboard instead", () => {
    // Asking for an onboarding link here shows someone a form they already filled
    // in — and `account_update`, the obvious third option, does not exist on
    // Express at all.
    expect(chooseConnectLink({ details_submitted: true })).toBe("login");
  });

  it("treats an unknown state as unfinished", () => {
    // Guidance is the safe default, the same direction the tenant-facing tab takes:
    // an onboarding link for a finished account is a wasted click, while a login
    // link for an unfinished one is a refusal.
    expect(chooseConnectLink({})).toBe("onboarding");
    expect(chooseConnectLink({ details_submitted: undefined })).toBe("onboarding");
  });
});

describe("onboardingLinkForm", () => {
  const page = "https://sofrapiwas.com/fr/onboarding/payments/tok";

  it("asks for an account_onboarding link", () => {
    expect(onboardingLinkForm("acct_1UCPNgFqVH9gPNlT", page).type).toBe("account_onboarding");
    expect(onboardingLinkForm("acct_1UCPNgFqVH9gPNlT", page).account).toBe("acct_1UCPNgFqVH9gPNlT");
  });

  it("points BOTH urls back at our own page", () => {
    // `refresh_url` is where Stripe sends someone whose link has expired — 300
    // seconds, so an ordinary event, not an error. Our page mints a new link on
    // every request, so landing back on it continues the journey. Anything else
    // strands a restaurant mid-KYC for having taken a phone call.
    const form = onboardingLinkForm("acct_1UCPNgFqVH9gPNlT", page);
    expect(form.refresh_url).toBe(page);
    expect(form.return_url).toBe(page);
  });
});

describe("newOnboardingToken", () => {
  it("is unguessable and URL-safe", () => {
    // 32 random bytes, base64url: it is the whole access control on a page that
    // can set a restaurant's payout bank account.
    const token = newOnboardingToken();
    expect(token).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(token).not.toContain("+");
    expect(token).not.toContain("/");
    expect(token).not.toContain("=");
  });

  it("never repeats", () => {
    const many = new Set(Array.from({ length: 500 }, newOnboardingToken));
    expect(many.size).toBe(500);
  });
});

describe("resolvePaymentsLink", () => {
  it("answers an empty token with the same 404 as a wrong one, and touches nothing", async () => {
    // An empty URL segment is the one input a bad link reliably produces. It is
    // refused before the database and before Stripe — so this test also proves the
    // ordering, since a suite with no DB would otherwise fail loudly here.
    await expect(resolvePaymentsLink("", "https://sofrapiwas.com/en/onboarding/payments/")).resolves.toEqual({
      kind: "unknownToken",
    });
  });
});

describe("paymentsPageUrl — what goes into the registry entry", () => {
  it("is the page's own URL with NO locale prefix", () => {
    // `middleware.ts` redirects an unprefixed path to the visitor's language, so
    // one stored URL serves a Swiss restaurant whose staff read French and whose
    // owner reads German. Baking `/en/` in would choose for them, permanently, in
    // a value that is copied into a box `.env`.
    expect(paymentsPageUrl("https://sofrapiwas.com", "tok123")).toBe(
      "https://sofrapiwas.com/onboarding/payments/tok123",
    );
    expect(paymentsPageUrl("https://sofrapiwas.com", "tok123")).not.toContain("/en/");
  });

  it("survives a base URL with a trailing slash", () => {
    // `NEXTAUTH_URL` is hand-written in a box `.env`; a trailing slash there would
    // otherwise produce `//onboarding/...`, which is a different path and a 404 on
    // the day somebody is trying to get paid.
    expect(paymentsPageUrl("https://staging.sofrapiwas.com/", "tok")).toBe(
      "https://staging.sofrapiwas.com/onboarding/payments/tok",
    );
    expect(paymentsPageUrl("https://staging.sofrapiwas.com///", "tok")).toBe(
      "https://staging.sofrapiwas.com/onboarding/payments/tok",
    );
  });

  it("keeps the environment it was given", () => {
    // The reason the URL is finished HERE and not on the box: a per-environment
    // concatenation eventually points a working link at the wrong site.
    expect(paymentsPageUrl("https://staging.sofrapiwas.com", "t")).toContain("staging.");
  });
});
