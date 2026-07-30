import { expect, test } from "./helpers/fixtures";
import {
  activateAndLogin,
  attemptProvision,
  loginAsAdmin,
  mintInviteLink,
  submitSignup,
  uniq,
} from "./helpers/flows";
import { findFirstPayment, findPlan, findUser } from "./helpers/db";

// The paid half of O2, against the REAL Mollie API on a test_ key. Nothing is
// mocked: a real customer, a real first payment, Mollie's own hosted checkout
// driven in the browser, and our own webhook handler re-fetching the payment from
// Mollie to decide what to do.
//
// The one hop that is stood in for is Mollie CALLING US. It cannot: Mollie
// validates webhook reachability when a payment is created and answers 422 for a
// localhost URL, so `MOLLIE_WEBHOOK_URL` points at an inert public sink during the
// run (lib/billing.ts) and the spec POSTs the real `tr_` id to the local handler
// itself. That is delivery, not verification — the handler still re-fetches from
// the real API and acts only on what it gets back, so fetch-and-verify, the
// mandate race and the activation path are all genuinely exercised.
//
// CLAUDE.md §9: a `live_` key must never reach this file. scripts/e2e-suite.sh
// refuses to start with one, and the guard below skips the whole file rather than
// letting it pass quietly when no test key is configured.

const mollieKey = process.env.MOLLIE_API_KEY ?? "";

test.describe("Mollie first payment and activation", () => {
  test.skip(
    !mollieKey,
    "MOLLIE_API_KEY is not set — export MOLLIE_API_KEY_TEST and run scripts/e2e-suite.sh",
  );
  test.skip(
    !mollieKey.startsWith("test_"),
    "MOLLIE_API_KEY is not a test_ key — refusing to exercise billing (CLAUDE.md §9)",
  );

  // The config's 30s default cannot hold this test, and the shortfall would hide
  // the very thing it exists to check: Mollie's sandbox usually validates the
  // mandate at once, but the lag observed on staging was ~80s and the retry
  // schedule reaches ~26h. At 30s the run dies mid-`waitForURL` on the Mollie
  // redirect, reporting a bare Playwright timeout and discarding this file's own
  // diagnostics. Budget for a real lag instead: the retry loop alone can spend 60s.
  test.setTimeout(300_000);

  // Every green run creates a REAL recurring subscription in the Mollie test
  // account, with a startDate one interval out and a webhook pointing at the inert
  // sink. Left alone they keep generating monthly test charges into a dead URL
  // forever, and a CI retry doubles the rate. So cancel what this run created.
  //
  // Best-effort by design: a cleanup failure must not fail a run whose assertions
  // passed — it is tidiness, not a result. What it cannot do is silently skip, so
  // it reports what it cancelled.
  const created: Array<{ customerId: string; subscriptionId: string }> = [];
  test.afterAll(async () => {
    for (const { customerId, subscriptionId } of created) {
      try {
        const res = await fetch(
          `https://api.mollie.com/v2/customers/${customerId}/subscriptions/${subscriptionId}`,
          { method: "DELETE", headers: { Authorization: `Bearer ${mollieKey}` } },
        );
        console.log(`e2e cleanup: cancel ${subscriptionId} → ${res.status}`);
      } catch (e) {
        console.warn(`e2e cleanup: could not cancel ${subscriptionId}`, e);
      }
    }
  });

  // One owner, one plan, walked all the way through: the states depend on each
  // other, and re-driving a fresh Mollie checkout per assertion would multiply
  // real API calls for no extra coverage.
  test("a self-serve owner pays, the mandate race resolves, and the plan goes ACTIVE", async ({
    page,
    request,
  }) => {
    const slug = uniq.slug("pay");
    const email = uniq.email("pay");
    const password = `e2e-pay-pass-${Date.now()}`;

    // ── the owner arrives with a PENDING plan ──────────────────────────────
    await submitSignup(page, { slug, email, restaurantName: "Chez Payment" });
    await expect(page.getByText(/check your email to set your password/i)).toBeVisible();
    const user = await findUser(email);
    await activateAndLogin(page, { inviteLink: await mintInviteLink(user!.id), email, password });

    const before = await findPlan(slug);
    expect(before!.subStatus).toBe("PENDING");
    expect(before!.hasMollieCustomer, "no Mollie customer until payment starts").toBe(false);

    // ── clicking pay reaches Mollie's own hosted checkout ──────────────────
    await page.getByRole("button", { name: /start auto-monthly payment/i }).click();
    await page.waitForURL(/mollie\.com/, { timeout: 45_000 });
    expect(page.url()).toContain("mollie.com");

    const started = await findPlan(slug);
    expect(started!.hasMollieCustomer, "the customer is created on demand").toBe(true);
    const payment = await findFirstPayment(slug);
    expect(payment, "a first payment row must exist").not.toBeNull();
    expect(payment!.molliePaymentId).toMatch(/^tr_/);
    expect(["open", "pending"]).toContain(payment!.status);

    // ── complete it in Mollie's test checkout ──────────────────────────────
    await completeMollieTestCheckout(page);

    // ── drive the webhook the way Mollie would ─────────────────────────────
    // The first delivery may legitimately answer 503: the paid first payment can
    // beat its recurring mandate going valid, and the handler answers non-2xx so
    // Mollie redelivers (MandateNotReadyError). That is the single most important
    // behaviour here, because a 200 in that window would strand the plan in
    // PENDING forever — the paid transition is the last webhook Mollie sends
    // unprompted. So retry like Mollie does, and assert the plan is never left
    // half-activated in between.
    const paymentId = payment!.molliePaymentId;
    let sawMandateRace = false;
    let activated = false;

    for (let attempt = 1; attempt <= 12 && !activated; attempt += 1) {
      const res = await request.post("/api/webhooks/mollie", {
        form: { id: paymentId },
      });
      if (res.status() === 503) {
        sawMandateRace = true;
        // Nothing may be half-done in this window.
        const midway = await findPlan(slug);
        expect(midway!.subStatus, "a not-yet-valid mandate must not activate").not.toBe("ACTIVE");
        expect(midway!.mollieSubscriptionId).toBeNull();
        // ...and the owner must not be invited to pay again while it lasts. This
        // is where a double charge would come from: they have been charged, the
        // plan does not say "active", and "pay" is the obvious thing to try.
        await page.goto("/dashboard");
        await expect(
          page.getByRole("button", { name: /start auto-monthly payment/i }),
        ).toHaveCount(0);
        await page.waitForTimeout(5_000);
        continue;
      }
      expect(res.status(), "the webhook must answer 200 or 503, never 500").toBe(200);
      activated = (await findPlan(slug))!.subStatus === "ACTIVE";
      if (!activated) await page.waitForTimeout(5_000);
    }

    const done = await findPlan(slug);
    expect(
      done!.subStatus,
      `plan never reached ACTIVE (mandate race seen: ${sawMandateRace})`,
    ).toBe("ACTIVE");
    expect(done!.mollieSubscriptionId, "an ACTIVE plan must carry its Mollie subscription id")
      .toMatch(/^sub_/);
    expect((await findFirstPayment(slug))!.status).toBe("paid");
    // Hand the real Mollie resources to the teardown now that they exist.
    created.push({
      customerId: done!.mollieCustomerId!,
      subscriptionId: done!.mollieSubscriptionId!,
    });

    // ── the owner's own dashboard agrees ───────────────────────────────────
    // `/dashboard` — NOT `/dashboard/billing`, which is `requirePartner()` and
    // redirects an owner straight back here. Asserting there would have "passed"
    // against this same page while claiming to check a billing view the owner
    // cannot reach, on a `/active/i` match loose enough to hit "Not active."
    // and "Activating" too.
    await page.goto("/dashboard");
    await expect(page.getByText(/your subscription is active/i)).toBeVisible();
    await expect(page.getByRole("button", { name: /start auto-monthly payment/i })).toHaveCount(0);
    // The mandate-lag panel must be gone now that it really is active.
    await expect(page.getByText(/is being set up/i)).toHaveCount(0);

    // ── and provisioning is now allowed for this tenant ────────────────────
    // The same slug that was refused while unpaid. Both halves are asserted: the
    // refusal is gone AND the request reached GitHub, which fails on the
    // placeholder token. Without the positive half this would also pass on a
    // stale page, a redirect, or an unrelated error.
    await page.context().clearCookies();
    await loginAsAdmin(page);
    const gate = await attemptProvision(page, slug);
    expect(gate).not.toMatch(/no settled first payment/i);
    expect(gate).toMatch(/bad credentials|401/i);
  });

});

/**
 * Drive Mollie's test-mode hosted checkout to a paid outcome.
 *
 * The three real steps, as Mollie serves them:
 *   /checkout/select-method  → `button[name=method]`
 *   /checkout/select-issuer  → `button[name=issuer]`  (iDEAL only)
 *   /checkout/test-mode      → `input[name=final_state][value=paid]` + `button[name=submit]`
 *
 * Selected by FORM ATTRIBUTE, never by visible text. Mollie localises this
 * checkout from the browser/account locale — the status chooser came back in
 * Dutch on the first run, where "paid" reads "Betaald" — so any accessible-name
 * selector would pass or fail depending on where the suite happens to run. The
 * `name`/`value` pairs are part of Mollie's form contract and are stable.
 *
 * iDEAL is chosen deliberately: it supports `sequenceType: first` (it can create
 * a recurring mandate) and its test flow needs no card details.
 */
async function completeMollieTestCheckout(page: import("@playwright/test").Page): Promise<void> {
  const step = async (what: string, action: () => Promise<void>) => {
    try {
      await action();
      await page.waitForLoadState("domcontentloaded");
    } catch (e) {
      throw new Error(
        `Mollie test checkout: "${what}" failed at ${page.url()}\n` +
          `page text was:\n${(await page.locator("body").innerText().catch(() => "")).slice(0, 1000)}\n` +
          `cause: ${String(e)}`,
      );
    }
  };

  await step("select a payment method (iDEAL)", async () => {
    await page.locator('button[name="method"]', { hasText: /iDEAL/i }).first().click();
  });

  await step("select an iDEAL issuer", async () => {
    await page.locator('button[name="issuer"]').first().click();
  });

  await step('choose the "paid" final state and continue', async () => {
    await page.locator('input[name="final_state"][value="paid"]').check();
    await page.locator('button[name="submit"]').first().click();
  });

  // Mollie then redirects to our redirectUrl (the local server's
  // /billing/thanks). Deliberately not asserted: what matters is the payment's
  // state at Mollie, which the caller reads back through our own handler.
}
