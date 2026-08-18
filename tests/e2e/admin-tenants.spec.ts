import { expect, test } from "./helpers/fixtures";
import { loginAsAdmin } from "./helpers/flows";

// /admin/tenants and the Stripe half of a registry entry (SOFRA-PAYMENTS-PLAN §9 P3).
//
// Why this needs a browser rather than a unit test: the value never reached the
// component at all. `stripe_account` is in registry.yml's vocabulary and is read by
// `provision-tenant.sh`, but sofra's zod schema stripped it before any page could see
// it — so the founder had no way to tell a tenant that can take a card from one that
// cannot, short of opening the deploy repo. Nothing is mocked here: the real registry
// fixture is on TENANT_REGISTRY_PATH, the real parse runs, the real page renders.

test.describe("the founder can see which tenants can take a card", () => {
  test("an entry with an account shows it, and one without the account is flagged", async ({
    page,
  }) => {
    await loginAsAdmin(page);
    await page.goto("/admin/tenants", { waitUntil: "domcontentloaded" });

    // Present and paired: the id itself, because that is the string the founder
    // pastes into Stripe's dashboard search when something is wrong.
    await expect(page.getByText("acct_1E2eFixtureCard")).toBeVisible();

    // Bought the module, no account. The warning must be attached to THIS card,
    // not merely somewhere on the page — a page-wide text match would pass even
    // if it rendered against the wrong tenant.
    const unpaired = page.locator("li").filter({ hasText: "e2e-unpaired" });
    await expect(unpaired.getByRole("alert")).toBeVisible();

    // …and must NOT be attached to the paired one. This is the assertion that
    // fails if the condition is inverted or dropped, which a one-sided test
    // would not catch.
    const card = page.locator("li").filter({ hasText: "e2e-card" });
    await expect(card.getByRole("alert")).toHaveCount(0);

    // A tenant that never bought the module is silent about Stripe entirely.
    const occupied = page.locator("li").filter({ hasText: "e2e-occupied" });
    await expect(occupied.getByRole("alert")).toHaveCount(0);
    await expect(occupied.getByText(/acct_/)).toHaveCount(0);
  });
});
