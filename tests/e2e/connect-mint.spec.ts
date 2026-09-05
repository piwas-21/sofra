import { expect, test } from "./helpers/fixtures";
import { mintForProposal } from "@/lib/provisioning-mint";
import { RUN_ID, uniq } from "./helpers/flows";
import {
  findConnectAccounts,
  findConnectAccountsForRun,
  forgetConnectAccount,
} from "./helpers/db";

// The MINT CHAIN, run in one piece for the first time (ADR-011 amendment, E1–E4).
//
// `mintForProposal -> createExpressAccount -> recordConnectAccount -> the fields a
// registry entry carries` was unit-tested, mutation-tested, and every Stripe call in
// it had been probed BY HAND — but the chain itself had never executed end to end in
// any environment (BACKLOG: "The mint path has NEVER run end to end anywhere").
// `sofra-staging` cannot rehearse it: `provisioningConfigured()` is
// `Boolean(process.env.PROVISION_GITHUB_TOKEN)` and that variable is absent there, so
// `openProvisioningPr` refuses before it reaches the mint. Without this file the first
// ever run of the hand-offs would be a real restaurant's account.
//
// So this exercises everything BELOW `openProvisioningPr` — the GitHub half is not
// here, deliberately: it writes to the deploy repo, which is not a throwaway.
//
// Nothing is mocked (CLAUDE.md §7). Real `POST /v1/accounts` against the REAL Stripe
// API on an `sk_test_` key, the suite's throwaway Postgres, and the suite's own running
// server for the locale claim. Every account created here is a real Stripe object and
// is DELETED in `afterAll`, whatever the tests did.
//
// TEST MODE ONLY, and the reason is not squeamishness. A test-mode account can be
// deleted; Stripe refuses to delete a LIVE account "that has access to the standard
// dashboard and [for which] Stripe is responsible for negative account balances".
// Express happens to have neither property (measured on the live platform 2026-09-05,
// `deleted: true` then GET -> 403), so the refusal would not actually fire — but a live
// connected account is a real KYC/compliance object attached to a real business, and a
// suite that creates one on every run has no business existing. Hence the guard below,
// `scripts/e2e-suite.sh`'s hard refusal of anything but `sk_test_`, and CI's.

const stripeKey = process.env.STRIPE_API_KEY ?? "";

/**
 * Why this file may not run, or null when it may.
 *
 * Applied from INSIDE each test body rather than at describe scope, for the reason
 * `billing-mollie.spec.ts` gives: a describe-level `test.skip(cond, reason)` reads to a
 * static analyser as a permanently-disabled test, which is the opposite of what it is —
 * a runtime decision that reports itself. Playwright marks the run SKIPPED either way,
 * never passed.
 */
const skipReason = (() => {
  if (!stripeKey) {
    return "STRIPE_API_KEY is not set — export STRIPE_API_KEY_TEST and run scripts/e2e-suite.sh";
  }
  if (!stripeKey.startsWith("sk_test_")) {
    return "STRIPE_API_KEY is not an sk_test_ key — refusing to mint connected accounts (CLAUDE.md §9)";
  }
  return null;
})();

/** The slice of Stripe's Account object this file reads back. */
type StripeAccount = {
  id: string;
  type?: string;
  country?: string;
  email?: string;
  business_profile?: { name?: string; url?: string; mcc?: string };
  capabilities?: Record<string, string>;
  metadata?: Record<string, string>;
  deleted?: boolean;
};

/**
 * Stripe, called DIRECTLY rather than through `lib/stripe.ts`.
 *
 * Two reasons, and both are about not letting the test share the code under test.
 * `stripeGet` throws on a non-2xx, and the status IS the assertion here (a deleted
 * account answers 403). And `DELETE /v1/accounts` is a capability the application must
 * never have: nothing in this app may destroy a restaurant's payment account, so it
 * stays in the test process where the only accounts it can reach are test-mode ones.
 */
async function stripeApi<T>(
  method: "GET" | "DELETE",
  path: string,
): Promise<{ status: number; body: T }> {
  const res = await fetch(`https://api.stripe.com${path}`, {
    method,
    headers: { Authorization: `Bearer ${stripeKey}` },
  });
  return { status: res.status, body: (await res.json()) as T };
}

/**
 * The account ids Stripe itself holds for a tenant slug, read from
 * `metadata[sofra_tenant]` — the tag `expressAccountForm` sets on every mint.
 *
 * This is the only oracle that can see the failure that matters: a SECOND live account
 * for one restaurant. The database cannot, because `tenantSlug` is unique there — a
 * duplicate mint would show up as one row and one orphan at Stripe.
 *
 * `limit=100` with no cursor is enough: the list is newest-first, and anything this run
 * created is at the front of it.
 */
async function stripeAccountsFor(slug: string): Promise<string[]> {
  const { status, body } = await stripeApi<{ data?: StripeAccount[] }>(
    "GET",
    "/v1/accounts?limit=100",
  );
  expect(status, "listing the platform's connected accounts").toBe(200);
  return (body.data ?? [])
    .filter((a) => a.metadata?.sofra_tenant === slug)
    .map((a) => a.id);
}

/**
 * The tenant minted by the first test, kept so the later tests can use the SAME listing
 * call as a positive control. "No account was created for this slug" is an empty
 * result, and an empty result from an instrument that can no longer see anything reads
 * identically — so every such claim below is paired with a slug that must be found.
 */
let control: { slug: string; account: string } | null = null;

/** The modules a tenant that bought card payments carries. `online-payments` is the
 *  one that pairs with an account (ACCOUNT_PAIRED_MODULE_IDS); `core` rides along
 *  because every tenant has it, so the mint has to find its trigger in a list rather
 *  than in the only element. */
const PAID_MODULES = ["core", "online-payments"];

/** The input two tests share, minus the parts each varies. */
function proposal(slug: string, over: { currency: string; modules: string[] }) {
  return {
    slug,
    name: "Chez Mint",
    adminEmail: `${slug}@example.test`,
    url: `https://${slug}.sofrapiwas.com`,
    ...over,
  };
}

// SERIAL, and it is a real dependency rather than tidiness: the second and third tests
// use the first test's account as the positive control for the Stripe listing. If the
// mint fails there is no control, and Playwright skipping the rest is the correct
// outcome — better than two tests that "pass" on an instrument nothing proved awake.
test.describe.configure({ mode: "serial" });

test.describe("minting a tenant's Stripe Connect account", () => {
  // A real account creation, a read-back, a replay and a listing — all network, none of
  // it under our control. The config's 30s default is not a budget for that.
  test.setTimeout(120_000);

  // NOT best-effort, unlike the Mollie spec's teardown. There a failed cleanup leaves a
  // test subscription charging into a dead sink; here it leaves a live-shaped connected
  // account, on a platform, with a KYC surface and an onboarding link that anyone
  // holding the token can open. So the deletion is ASSERTED, and asserted for every
  // account before the first failure is reported — a loop that threw on account one
  // would leak accounts two and three.
  //
  // The inventory is taken from the DATABASE and from STRIPE, not from what a test
  // remembered to hand over: the account that most needs deleting is the one created by
  // a test that then failed on the next line. The Stripe half also covers the one case
  // the database cannot — a mint that succeeded and whose row write did not.
  test.afterAll(async () => {
    if (skipReason !== null) return;

    const rows = await findConnectAccountsForRun(RUN_ID);
    const listed = await stripeApi<{ data?: StripeAccount[] }>("GET", "/v1/accounts?limit=100");
    expect(listed.status, "cleanup could not list the platform's accounts").toBe(200);
    const tagged = (listed.body.data ?? [])
      .filter((a) => (a.metadata?.sofra_tenant ?? "").endsWith(RUN_ID))
      .map((a) => a.id);
    const ids = [...new Set([...rows.map((r) => r.stripeAccountId), ...tagged])];

    const outcomes: Array<{ id: string; deleted: boolean | null; afterGet: number | null; error?: string }> = [];
    for (const id of ids) {
      try {
        const del = await stripeApi<{ deleted?: boolean }>("DELETE", `/v1/accounts/${id}`);
        const after = await stripeApi<unknown>("GET", `/v1/accounts/${id}`);
        outcomes.push({ id, deleted: del.body.deleted ?? null, afterGet: after.status });
      } catch (e) {
        outcomes.push({ id, deleted: null, afterGet: null, error: String(e) });
      }
    }

    console.log(`e2e cleanup: ${outcomes.length} connected account(s) — ${JSON.stringify(outcomes)}`);
    for (const o of outcomes) {
      expect(o.deleted, `deleting ${o.id} did not answer deleted:true (${o.error ?? "no error"})`).toBe(true);
      // The deletion, confirmed by something other than the deletion's own reply.
      expect(o.afterGet, `${o.id} is still readable after being deleted`).toBe(403);
    }
  });

  test("a CHF tenant that bought online-payments is minted, recorded, and replayable", async ({
    request,
  }) => {
    test.skip(skipReason !== null, skipReason ?? "");

    const slug = uniq.slug("mint");
    const input = proposal(slug, { currency: "CHF", modules: PAID_MODULES });

    // ── the mint ──────────────────────────────────────────────────────────
    const first = await mintForProposal(input);
    expect(first.note ?? null, "the mint must not have been refused").toBeNull();
    expect(first.stripeAccount ?? "", "the account id the registry entry would carry").toMatch(
      /^acct_[A-Za-z0-9]+$/,
    );
    const account = first.stripeAccount!;
    control = { slug, account };

    // ── the link that goes into the registry entry ────────────────────────
    // Absolute (the URL constructor throws otherwise) and UNPREFIXED. The prefix
    // matters because this value is copied into a box `.env` and then shown to
    // everyone at the restaurant: baking `/fr/` in would pick a language, once and
    // permanently, for a Swiss tenant whose staff read French and whose owner reads
    // German. Asserting the first segment is `onboarding` refuses ANY prefix, not just
    // the six in i18n/routing.ts.
    const link = new URL(first.paymentsLinkUrl ?? "");
    expect(link.pathname.split("/")[1], "the stored URL must carry no locale prefix").toBe(
      "onboarding",
    );
    expect(link.pathname).toMatch(/^\/onboarding\/payments\/[A-Za-z0-9_-]{20,}$/);
    expect(link.origin, "minted against this environment's own base").toBe(
      new URL(process.env.NEXTAUTH_URL ?? "").origin,
    );

    // ── and the unprefixed URL really does serve two readers ──────────────
    // The claim above is about a string; this is the behaviour. Redirects are NOT
    // followed: the middleware's own Location header is the answer, and following it
    // would mint a real Stripe Account Link for a page nobody is looking at.
    const fr = await request.get(link.toString(), {
      maxRedirects: 0,
      headers: { "accept-language": "fr" },
    });
    const de = await request.get(link.toString(), {
      maxRedirects: 0,
      headers: { "accept-language": "de" },
    });
    expect(fr.headers().location, "a French reader is sent to the French page").toContain(
      "/fr/onboarding/payments/",
    );
    expect(de.headers().location, "a German reader is sent to the German page").toContain(
      "/de/onboarding/payments/",
    );
    expect(fr.headers().location, "one URL, two answers").not.toBe(de.headers().location);

    // ── the row that survives a crash before the registry PR ──────────────
    const rows = await findConnectAccounts(slug);
    expect(rows, "exactly one StripeConnectAccount row").toHaveLength(1);
    expect(rows[0].stripeAccountId).toBe(account);
    expect(rows[0].onboardingToken, "a row with no token is unreachable by its own page").not.toBeNull();
    expect(link.pathname.endsWith(rows[0].onboardingToken ?? "\u0000"), "the URL addresses THIS row").toBe(true);
    expect(rows[0].country, "derived from CHF, and immutable at Stripe afterwards").toBe("CH");
    // The convention spelled out rather than imported: a changed key is a new live
    // account, so the value is the assertion.
    expect(rows[0].idempotencyKey).toBe(`${slug}-connect-express-v1`);

    // ── what Stripe actually holds ────────────────────────────────────────
    // The hand-off nobody had ever observed: that the payload this chain composes
    // arrives as the account the registry entry then names.
    const got = await stripeApi<StripeAccount>("GET", `/v1/accounts/${account}`);
    expect(got.status).toBe(200);
    expect(got.body.type, "Express — the type is fixed at creation").toBe("express");
    expect(got.body.country).toBe("CH");
    expect(got.body.metadata?.sofra_tenant, "the tag that traces an account to a tenant").toBe(slug);
    expect(got.body.business_profile?.url).toBe(input.url);
    expect(got.body.business_profile?.mcc, "eating places").toBe("5812");
    // Requested TOGETHER in the create call: omitting one fails quietly, and
    // card_payments is refused without transfers.
    for (const capability of ["card_payments", "transfers", "twint_payments"]) {
      expect(
        Object.keys(got.body.capabilities ?? {}),
        `${capability} must have been requested at creation — it cannot be added by update`,
      ).toContain(capability);
    }

    // ── IDEMPOTENCY 1: the ordinary re-run reads our own row ──────────────
    const second = await mintForProposal(input);
    expect(second.stripeAccount, "a second proposal must not mint a second account").toBe(account);
    expect(second.paymentsLinkUrl, "and must not re-issue the link already recorded").toBe(
      first.paymentsLinkUrl,
    );
    expect(await findConnectAccounts(slug), "still one row").toHaveLength(1);

    // ── IDEMPOTENCY 2: the crash this whole table exists for ──────────────
    // The window is real: the account exists at Stripe the moment `POST /v1/accounts`
    // returns, and the row is written after it. Deleting the row reproduces exactly
    // that state, and it is the only way to make the next attempt go to STRIPE again —
    // which is what proves the recovery is the idempotency key rather than the row.
    expect(await forgetConnectAccount(slug), "the crash, arranged").toBe(1);
    const replay = await mintForProposal(input);
    expect(replay.stripeAccount, "a replay after a crash must RECOVER the account, not mint a twin").toBe(
      account,
    );
    expect(await findConnectAccounts(slug), "and re-record it once").toHaveLength(1);
    // The link is NOT the same one: the token is minted with the row, so the recovered
    // row carries a new one. Harmless precisely because this window closes before the
    // registry PR is composed — nothing has published the first token yet. It would not
    // be harmless later, which is why nothing else deletes this row.
    expect(replay.paymentsLinkUrl).not.toBe(first.paymentsLinkUrl);

    // The claim the database cannot make: Stripe holds ONE account for this tenant.
    expect(await stripeAccountsFor(slug), "one tenant, one live account").toEqual([account]);
  });

  test("a tenant that did not buy online-payments mints nothing", async () => {
    test.skip(skipReason !== null, skipReason ?? "");
    expect(control, "needs the first test's account as a positive control").not.toBeNull();

    const slug = uniq.slug("cash");
    const result = await mintForProposal(proposal(slug, { currency: "CHF", modules: ["core"] }));

    // `{}` and not a note: nothing was attempted, so there is nothing to report to a
    // founder. A note here would put "no Stripe account" in the PR body of every
    // cash-only restaurant we ever provision.
    expect(result, "no account, no link, and nothing to explain").toEqual({});
    expect(await findConnectAccounts(slug)).toHaveLength(0);
    expect(await stripeAccountsFor(slug), "and no live account at Stripe").toEqual([]);
    // ...proven to be a real answer rather than a blind instrument.
    expect(await stripeAccountsFor(control!.slug), "positive control").toEqual([control!.account]);
  });

  test("EUR refuses BEFORE Stripe is called, and the refusal says why", async () => {
    test.skip(skipReason !== null, skipReason ?? "");
    expect(control, "needs the first test's account as a positive control").not.toBeNull();

    const eurSlug = uniq.slug("eur");
    const chfSlug = uniq.slug("ctl");
    const key = process.env.STRIPE_API_KEY;

    // A DELIBERATELY BROKEN key, for the length of these two calls. It is what makes
    // "no network call" observable rather than asserted from reading the source: a call
    // that reached Stripe would come back 401 and say so in the note. The CHF case
    // below is the control that proves the broken key really does surface — without it,
    // "the note is not a 401" would also be true of a key that still worked.
    let eur: Awaited<ReturnType<typeof mintForProposal>>;
    let chf: Awaited<ReturnType<typeof mintForProposal>>;
    try {
      process.env.STRIPE_API_KEY = "sk_test_deliberately_invalid_key_for_this_control";
      eur = await mintForProposal(proposal(eurSlug, { currency: "EUR", modules: PAID_MODULES }));
      chf = await mintForProposal(proposal(chfSlug, { currency: "CHF", modules: PAID_MODULES }));
    } finally {
      process.env.STRIPE_API_KEY = key;
    }

    // The control first: with this key, anything that REACHES Stripe is refused.
    expect(chf.stripeAccount ?? null, "the control must not have minted anything").toBeNull();
    expect(chf.note ?? "", "the broken key is visible when the call is made").toMatch(
      /401|invalid api key/i,
    );

    // So EUR, answering with a country refusal instead, never got that far.
    expect(eur.stripeAccount ?? null).toBeNull();
    expect(eur.note ?? "", "seven countries share EUR, and Stripe fixes the country forever").toMatch(
      /EUR does not name one country/,
    );
    expect(eur.note ?? "").not.toMatch(/401|invalid api key/i);

    expect(await findConnectAccounts(eurSlug), "no row for a refused currency").toHaveLength(0);
    expect(await stripeAccountsFor(eurSlug), "and no account at Stripe").toEqual([]);
    expect(await stripeAccountsFor(control!.slug), "positive control").toEqual([control!.account]);
  });
});
