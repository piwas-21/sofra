import { expect, test } from "./helpers/fixtures";
import {
  activateAndLogin,
  mintInviteLink,
  submitSignup,
  uniq,
  expectAccountCreated,
} from "./helpers/flows";
import { arrangeActivePlan, findUser, repointBillingSlug } from "./helpers/db";

// O7 P4 (SOFRA-PAYMENTS-PLAN §9) — the one window nothing else covers.
//
// A self-serve buyer of `online-payments` is provisioned WITHOUT the module: P1 makes
// the module and the connected account a pair, because `provision-tenant.sh` refuses
// one without the other, and refuses it BEFORE the database. So they go live on
// everything else and trade on cash while their Stripe account is verified — paying,
// the whole time, for a module their app does not show. sofra is the only surface that
// can see both halves (§9 Q4: sofra knows what was BOUGHT, the tenant knows what is
// RUNNING), so it is the only surface that can say so.
//
// Nothing is mocked. The real signup writes the real `SignupRequest.modules`, the real
// registry fixture supplies the grant, and the real dashboard renders.

/** A signed-up, activated, logged-in owner who bought online payments. */
async function aCardBuyer(page: Parameters<typeof submitSignup>[0], name: string) {
  const slug = uniq.slug(name);
  const email = uniq.email(name);
  await submitSignup(page, {
    slug,
    email,
    restaurantName: `Chez ${name}`,
    modules: ["online-payments"],
  });
  await expectAccountCreated(page);
  const user = await findUser(email);
  await activateAndLogin(page, {
    inviteLink: await mintInviteLink(user!.id),
    email,
    password: `e2e-${name}-pass-${Date.now()}`,
  });
  await arrangeActivePlan(slug, { firstChargeIso: "2026-01-15T00:00:00Z" });
  return slug;
}

test.describe("the buyer is told about the module they cannot see yet", () => {
  test("bought and not yet granted — the card is there, and says nothing they can't act on", async ({
    page,
  }) => {
    // `e2e-occupied` is a registry entry whose `modules` are `[core]`: live, and
    // without the module this owner paid for. That IS the window.
    const slug = await aCardBuyer(page, "cardbuyer");
    await repointBillingSlug(slug, "e2e-occupied");

    await page.goto("/dashboard");
    const card = page.getByText(/card payments are on their way/i);
    await expect(card).toBeVisible();

    // The link the slice specifies — one, outbound, to Stripe's own dashboard.
    await expect(page.locator('a[href="https://dashboard.stripe.com"]')).toBeVisible();

    // Q3's answer (option B), the same policy the public FAQ states: billed from
    // activation, credited on request. It must be ON this card, not only in the FAQ —
    // the FAQ is not where somebody looks when the invoice arrives.
    await expect(page.getByText(/credit that month/i)).toBeVisible();

    // The copy rule, asserted where it actually renders rather than only over the
    // message files: whatever the page composed, the customer must not be reading
    // about our plumbing.
    await expect(page.getByText(/registry|pull request|deploy|environment variable/i))
      .toHaveCount(0);
  });

  test("bought and granted — the card is gone", async ({ page }) => {
    // `e2e-card` carries `modules: [core, online-payments]`, i.e. the second registry
    // PR has landed. Without this case the card could be unconditional and the test
    // above would still pass.
    const slug = await aCardBuyer(page, "cardgranted");
    await repointBillingSlug(slug, "e2e-card");

    await page.goto("/dashboard");
    // The dashboard rendered — otherwise "absent" proves nothing. The heading is the
    // SLUG, not the restaurant name: `OwnerPlanCard` falls back to `tenantSlug` when
    // there is no reseller `Client`, and the self-serve path never creates one.
    await expect(page.getByRole("heading", { name: /e2e-card/i })).toBeVisible();
    await expect(page.getByText(/card payments are on their way/i)).toHaveCount(0);
  });

  test("never bought it — the card is gone too", async ({ page }) => {
    // The default signup buys `kitchen-board` + `cashier`. A tenant on the same
    // module-less registry entry as the first test must still see nothing, which is
    // what separates "purchased and not granted" from "not granted".
    const slug = uniq.slug("nocard");
    const email = uniq.email("nocard");
    await submitSignup(page, { slug, email, restaurantName: "Chez Nocard" });
    await expectAccountCreated(page);
    const user = await findUser(email);
    await activateAndLogin(page, {
      inviteLink: await mintInviteLink(user!.id),
      email,
      password: `e2e-nocard-pass-${Date.now()}`,
    });
    await arrangeActivePlan(slug, { firstChargeIso: "2026-01-15T00:00:00Z" });
    await repointBillingSlug(slug, "e2e-retired");

    await page.goto("/dashboard");
    await expect(page.getByRole("heading", { name: /e2e-retired/i })).toBeVisible();
    await expect(page.getByText(/card payments are on their way/i)).toHaveCount(0);
  });
});
