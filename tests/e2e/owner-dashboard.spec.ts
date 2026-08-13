import { expect, test } from "./helpers/fixtures";
import { activateAndLogin, mintInviteLink, submitSignup, uniq } from "./helpers/flows";
import {
  arrangeActivePlan,
  arrangeMandateLag,
  arrangeProposalOpened,
  findPlan,
  findUser,
  repointBillingSlug,
} from "./helpers/db";

// The owner's dashboard (SOFRA-ONBOARDING-PLAN O4): the two things it now has to say
// that it did not before — *where is my app and how do I get in* (inherited from O3),
// and *what am I paying, and when next* (the gap O2 named and left open).
//
// Nothing is mocked. The health probe is real: the registry fixture's domains are
// `.example.test`, which resolves nowhere, so a probed tenant genuinely fails to
// answer. That is the assertion that matters most here — a merged registry entry must
// NOT be enough to tell a customer their app is ready, because the merge only STARTS
// the build. The "ready" branch itself is covered by the unit tests over `tenantStage`,
// which is where it can be exercised without standing up a tenant.

/** A signed-up, activated, logged-in owner sitting on their dashboard. */
async function anOwner(page: Parameters<typeof submitSignup>[0], name: string) {
  const slug = uniq.slug(name);
  const email = uniq.email(name);
  await submitSignup(page, { slug, email, restaurantName: `Chez ${name}` });
  await expect(page.getByText(/check your email/i)).toBeVisible();
  const user = await findUser(email);
  await activateAndLogin(page, {
    inviteLink: await mintInviteLink(user!.id),
    email,
    password: `e2e-${name}-pass-${Date.now()}`,
  });
  return { slug, email };
}

test.describe("the owner is told where their app is — and only what is true", () => {
  test("before paying, the app panel says nothing at all", async ({ page }) => {
    await anOwner(page, "quiet");
    // The call to action owns this moment — now "add your billing details",
    // since a charge that cannot be invoiced must not be taken. A "we are
    // preparing your app" line beside it would be a promise made before any
    // money moved.
    await expect(page.getByRole("link", { name: /add your billing details/i })).toBeVisible();
    await expect(page.getByText(/preparing your app/i)).toHaveCount(0);
    await expect(page.getByRole("link", { name: /set your admin password/i })).toHaveCount(0);
  });

  test("paid with nothing proposed yet says 'preparing', and hands out no link", async ({
    page,
  }) => {
    const { slug } = await anOwner(page, "prep");
    await arrangeActivePlan(slug, { firstChargeIso: "2026-01-15T00:00:00Z" });

    await page.goto("/dashboard");
    await expect(page.getByText(/preparing your app/i)).toBeVisible();
    await expect(page.getByRole("link", { name: /set your admin password/i })).toHaveCount(0);
    await expect(page.getByText(/your restaurant app is live/i)).toHaveCount(0);
  });

  test("an open proposal says 'being built', and still hands out no link", async ({ page }) => {
    const { slug } = await anOwner(page, "propose");
    await arrangeActivePlan(slug, { firstChargeIso: "2026-01-15T00:00:00Z" });
    await arrangeProposalOpened(slug, "https://github.com/piwas-21/restaurant-app-deploy/pull/999");

    await page.goto("/dashboard");
    await expect(page.getByText(/your app is being built/i)).toBeVisible();
    await expect(page.getByRole("link", { name: /set your admin password/i })).toHaveCount(0);
  });

  test("the mandate-lag window is not told the same thing twice", async ({ page }) => {
    // While `<ActivatingPanel />` is up it already spells out the whole wait, ending
    // with "then your app is prepared". "We are preparing your app" directly beneath it
    // is the same sentence again, and a line that restates the line above it is worse
    // than no line. `visibleTenantStage` silences exactly those two stages here.
    const { slug } = await anOwner(page, "twice");
    await arrangeMandateLag(slug);

    await page.goto("/dashboard");
    await expect(page.getByText(/your first payment went through/i)).toBeVisible();
    await expect(page.getByText(/preparing your app/i)).toHaveCount(0);
    await expect(page.getByText(/your app is being built/i)).toHaveCount(0);
  });

  test("a MERGED registry entry is still not 'ready' — the app has to answer", async ({ page }) => {
    // The single most important assertion in this file. Under the O3 merge chain the
    // founder's merge starts a build that takes ~15 minutes and can fail; a dashboard
    // that read the entry as "live" would send a customer to a connection error on the
    // very first thing the product ever asked them to do.
    //
    // Arranged in the mandate-lag window on purpose: `almostReady` is one of the two
    // stages that must SURVIVE the suppression above, because unlike "preparing" it is
    // information `ActivatingPanel` does not have.
    const { slug } = await anOwner(page, "merged");
    await arrangeMandateLag(slug);
    await repointBillingSlug(slug, "e2e-occupied");

    await page.goto("/dashboard");
    await expect(page.getByText(/almost there/i)).toBeVisible();
    await expect(page.getByRole("link", { name: /set your admin password/i })).toHaveCount(0);
    await expect(page.getByText(/your restaurant app is live/i)).toHaveCount(0);
    // And no half-built link leaks into the page either.
    await expect(page.locator('a[href*="e2e-occupied.example.test"]')).toHaveCount(0);
  });
});

test.describe("an owner with an active plan is shown their plan", () => {
  test("amount, next charge and payment history — not 'nothing to do here'", async ({ page }) => {
    const { slug } = await anOwner(page, "active");
    // A plan whose FIRST recurring charge was 15 Jan 2026 and which has billed monthly
    // since — i.e. `startDate` is in the past, the only shape production can produce
    // once a recurring payment exists.
    await arrangeActivePlan(slug, { firstChargeIso: "2026-01-15T00:00:00Z" });

    await page.goto("/dashboard");

    // What they pay, re-read from their own subscription row. Matched with the
    // interval attached: the bare amount now also appears on every history row, and a
    // loose match would pass on a page that had lost the plan line entirely.
    await expect(page.getByText("€ 43,00 / month")).toBeVisible();
    // When it is taken next — the single most-asked billing question, and the one this
    // page could not answer at all before O4. It must be DERIVED: `startDate` is the
    // FIRST recurring charge and is never advanced, so printing that column puts a date
    // months in the past in front of a paying customer. The suite runs well after
    // 15 Jan 2026, so the right answer is a 15th still ahead of today — and the stale
    // one is precisely what the second assertion refuses.
    await expect(page.getByText(/next charge on 15 /i)).toBeVisible();
    await expect(page.getByText(/next charge on 15 Jan 2026/i)).toHaveCount(0);
    // Their history, in their words rather than Mollie's: `first`/`recurring` and
    // `paid` are our vendor's vocabulary, not a restaurant owner's.
    await expect(page.getByText(/payments/i).first()).toBeVisible();
    await expect(page.getByText(/first payment/i)).toBeVisible();
    await expect(page.getByText(/subscription charge/i)).toBeVisible();

    // The defaulted "nothing to do" this replaced must be gone, not merely pushed
    // below the fold.
    await expect(page.getByText(/nothing to do here right now/i)).toHaveCount(0);
    // An owner is still not a reseller.
    await expect(page.getByText(/add a client/i)).toHaveCount(0);

    expect((await findPlan(slug))!.subStatus).toBe("ACTIVE");
  });

  test("no pay button once the plan is active — that is the double-charge trap", async ({
    page,
  }) => {
    const { slug } = await anOwner(page, "nopay");
    await arrangeActivePlan(slug, { firstChargeIso: "2026-02-01T00:00:00Z" });

    await page.goto("/dashboard");
    // The POSITIVE assertion is what makes the negative one mean anything.
    //
    // On its own, "no pay button" passes vacuously now: this owner has no billing
    // identity, so the card short-circuits to the details link before the pay
    // branch is ever reached — and the button could not render in ANY state.
    // Mutating `planState` to drop its ACTIVE check, the exact regression this
    // test is named for, would still have gone green. Asserting the active line
    // pins that the card reached the active branch, so the absence below is
    // evidence about THAT branch rather than about a short-circuit above it.
    await expect(page.getByText(/next charge on/i)).toBeVisible();
    await expect(page.getByRole("button", { name: /start auto-monthly payment/i })).toHaveCount(0);
    await expect(page.getByRole("link", { name: /add your billing details/i })).toHaveCount(0);
  });
});
