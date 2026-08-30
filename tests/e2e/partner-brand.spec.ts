import { expect, test } from "./helpers/fixtures";
import { RUN_ID, login, uniq } from "./helpers/flows";
import {
  arrangeBillingIdentityFor,
  arrangePartnerBrand,
  arrangePartnerUser,
  findPartnerBrand,
} from "./helpers/db";

// A partner recording the PUBLIC details they may one day be shown by
// (SOFRA-PARTNER-PLAN §11).
//
// What this suite proves: the details are stored, the prefill carries the trade
// name and NOT the billing address, the publish switch is present but inert, and
// one partner's save cannot reach another partner's row even when the payload
// says it should.
//
// What it deliberately does NOT try to prove: that anything is published. Nothing
// consumes `publishToTenants` yet — that is §11e, an open owner decision — so
// there is no rendered footer to assert against, and a test that pretended
// otherwise would be asserting a feature that does not exist.

// Derived from the run id rather than written as a literal, for the reason
// partner-trial.spec.ts documents: a `const PASSWORD = "…"` line is a gitleaks
// `generic-api-key` hit (entropy, not meaning), and a scan that cries wolf on a
// test fixture is a scan people learn to skip past.
const PASSWORD = `e2e-brand-${RUN_ID}`;

test("a partner saves their public details, and the publish switch is inert", async ({ page }) => {
  const email = uniq.email("brandsave");
  const partnerId = await arrangePartnerUser(email, PASSWORD);

  await login(page, { email, password: PASSWORD });
  await page.waitForURL("**/dashboard");
  await page.getByRole("link", { name: /brand/i }).first().click();
  await page.waitForURL("**/dashboard/brand");

  await page.getByLabel(/display name/i).fill("Solution Eva");
  await page.getByLabel(/^city$/i).fill("Genève");
  await page.getByLabel(/website/i).fill("https://solutioneva.com");

  // Present, so the partner can see what is being decided about them — and
  // disabled, because nothing consumes it. An enabled switch that changed nothing
  // would be a lie told to the one person entitled to decide this.
  const publish = page.getByRole("checkbox");
  await expect(publish).toBeDisabled();
  await expect(page.getByText(/not available yet/i)).toBeVisible();

  await page.getByRole("button", { name: /^save$/i }).click();
  await expect(page.getByText(/^saved\.$/i)).toBeVisible();

  expect(await findPartnerBrand(partnerId)).toMatchObject({
    displayName: "Solution Eva",
    city: "Genève",
    // A disabled checkbox is not submitted, and the action reads an absent one as
    // false. Nothing a partner can do on this page turns publishing on today.
    publish: false,
  });
});

test("the prefill carries the trade name and NOT the billing address", async ({ page }) => {
  const email = uniq.email("brandprefill");
  const partnerId = await arrangePartnerUser(email, PASSWORD);
  await arrangeBillingIdentityFor(partnerId, {
    legalName: "Eva Obresse",
    tradeName: "Solution Eva",
    // A home address, which is what a sole trader's billing record actually is.
    // It must not appear on a page whose whole subject is what may become public.
    addressLine1: "Chemin Privé 7",
  });

  await login(page, { email, password: PASSWORD });
  await page.waitForURL("**/dashboard");
  await page.goto("/dashboard/brand");

  await expect(page.getByLabel(/display name/i)).toHaveValue("Solution Eva");
  await expect(page.getByLabel(/^address$/i)).toHaveValue("");
  await expect(page.getByLabel(/^postcode$/i)).toHaveValue("");
  await expect(page.getByLabel(/^city$/i)).toHaveValue("");
  // Not merely absent from the fields — absent from the page.
  await expect(page.getByText("Chemin Privé 7")).toHaveCount(0);
  // And nothing was stored by the mere act of looking: a prefill is a default in
  // an editable box, not a write.
  expect(await findPartnerBrand(partnerId)).toBeNull();
});

test("a partner cannot write another partner's brand, even by naming them", async ({ page }) => {
  const mine = uniq.email("brandmine");
  const theirs = uniq.email("brandtheirs");
  const mineId = await arrangePartnerUser(mine, PASSWORD);
  const theirsId = await arrangePartnerUser(theirs, PASSWORD);
  await arrangePartnerBrand(theirsId, "Their Brand");

  await login(page, { email: mine, password: PASSWORD });
  await page.waitForURL("**/dashboard");
  await page.goto("/dashboard/brand");

  // Their id is INJECTED into the payload — the shape of the attack the action is
  // written against. The key comes from the session, so the field is ignored; if
  // it were ever read, this is the request that would take over another company's
  // public identity.
  await page.evaluate((victimId) => {
    const form = document.querySelector("form");
    const field = document.createElement("input");
    field.type = "hidden";
    field.name = "partnerId";
    field.value = victimId;
    form?.appendChild(field);
  }, theirsId);

  await page.getByLabel(/display name/i).fill("My Brand");
  await page.getByRole("button", { name: /^save$/i }).click();
  await expect(page.getByText(/^saved\.$/i)).toBeVisible();

  expect(await findPartnerBrand(mineId)).toMatchObject({ displayName: "My Brand" });
  expect(await findPartnerBrand(theirsId)).toMatchObject({ displayName: "Their Brand" });
});
