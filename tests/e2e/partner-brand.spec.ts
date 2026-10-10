import { expect, test } from "./helpers/fixtures";
import { RUN_ID, login, uniq } from "./helpers/flows";
import {
  arrangeBillingIdentityFor,
  arrangePartnerBrand,
  arrangePartnerUser,
  findPartnerBrand,
} from "./helpers/db";

// A partner recording the PUBLIC details they may be shown by
// (SOFRA-PARTNER-PLAN §11).
//
// This suite proves the stored opt-in remains false by default, can be changed by
// the partner, and does not expose billing identity details. Applying that consent
// to an existing site is a separate reviewable registry proposal.

// Derived from the run id rather than written as a literal, for the reason
// partner-trial.spec.ts documents: a `const PASSWORD = "…"` line is a gitleaks
// `generic-api-key` hit (entropy, not meaning), and a scan that cries wolf on a
// test fixture is a scan people learn to skip past.
const PASSWORD = `e2e-brand-${RUN_ID}`;
const PUBLIC_BRAND_URL = `https://partner-brand-${RUN_ID}.test`;

test("a partner explicitly opts in to a public brand", async ({ page }) => {
  const email = uniq.email("brandsave");
  const partnerId = await arrangePartnerUser(email, PASSWORD);

  await login(page, { email, password: PASSWORD });
  await page.waitForURL("**/dashboard");
  await page.getByRole("link", { name: /brand/i }).first().click();
  await page.waitForURL("**/dashboard/brand");

  await page
    .getByRole("textbox", { name: /^display name$/i })
    .fill("Solution Eva");
  await page.getByLabel(/^city$/i).fill("Genève");
  await page.getByRole("textbox", { name: /^Website /i }).fill(PUBLIC_BRAND_URL);

  const publish = page.getByRole("checkbox", {
    name: /^Show your display name and website in the footer of restaurant sites you resell\.$/i,
  });
  await expect(publish).toBeEnabled();
  await expect(publish).not.toBeChecked();

  await page.getByRole("button", { name: /^save$/i }).click();
  await expect(
    page.getByText(/saved\. published changes update enabled sites automatically/i),
  ).toBeVisible();

  expect(await findPartnerBrand(partnerId)).toMatchObject({
    displayName: "Solution Eva",
    city: "Genève",
    websiteUrl: PUBLIC_BRAND_URL,
    publish: false,
  });

  await publish.check();
  await page.getByRole("button", { name: /^save$/i }).click();
  await expect(
    page.getByText(/saved\. published changes update enabled sites automatically/i),
  ).toBeVisible();
  expect(await findPartnerBrand(partnerId)).toMatchObject({ publish: true });
});

test("the prefill carries the trade name and NOT the billing address", async ({
  page,
}) => {
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

  await expect(
    page.getByRole("textbox", { name: /^display name$/i }),
  ).toHaveValue("Solution Eva");
  await expect(page.getByLabel(/^address$/i)).toHaveValue("");
  await expect(page.getByLabel(/^postcode$/i)).toHaveValue("");
  await expect(page.getByLabel(/^city$/i)).toHaveValue("");
  // Not merely absent from the fields — absent from the page.
  await expect(page.getByText("Chemin Privé 7")).toHaveCount(0);
  // And nothing was stored by the mere act of looking: a prefill is a default in
  // an editable box, not a write.
  expect(await findPartnerBrand(partnerId)).toBeNull();
});

test("a partner cannot write another partner's brand, even by naming them", async ({
  page,
}) => {
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

  await page.getByRole("textbox", { name: /^display name$/i }).fill("My Brand");
  await page.getByRole("button", { name: /^save$/i }).click();
  await expect(page.getByText(/saved\. published changes update enabled sites automatically/i)).toBeVisible();

  expect(await findPartnerBrand(mineId)).toMatchObject({
    displayName: "My Brand",
  });
  expect(await findPartnerBrand(theirsId)).toMatchObject({
    displayName: "Their Brand",
  });
});

test("a sole trader is told why their own name cannot be published (D-B1a)", async ({
  page,
}) => {
  const email = uniq.email("brandsole");
  const partnerId = await arrangePartnerUser(email, PASSWORD);
  // The case §11b is about: a legal record naming a PERSON, with no trade name. The
  // prefill therefore offers that person's own name — correct for a field they are
  // about to read and edit, and catastrophic if it were quietly published.
  await arrangeBillingIdentityFor(partnerId, {
    legalName: "Mustafa Vural",
    tradeName: null,
    addressLine1: "Chemin Privé 7",
  });

  await login(page, { email, password: PASSWORD });
  await page.waitForURL("**/dashboard");
  await page.goto("/dashboard/brand");

  // Said before they type, not after they save.
  await expect(page.getByText(/no trading name/i)).toBeVisible();
  await expect(
    page.getByText(/will not be shown on any restaurant/i),
  ).toBeVisible();

  // The save still SUCCEEDS — it is their record. The public projection refuses
  // this legal-name echo when a site proposal is built.
  await page.getByRole("button", { name: /^save$/i }).click();
  await expect(
    page.getByText(/saved\. published changes update enabled sites automatically/i),
  ).toBeVisible();
  expect(await findPartnerBrand(partnerId)).toMatchObject({
    displayName: "Mustafa Vural",
  });

  // Type a real brand and the warning goes; type the legal name back, in another
  // case and with stray spaces, and it returns — the comparison is normalised.
  await page
    .getByRole("textbox", { name: /^display name$/i })
    .fill("Solution Eva");
  await expect(
    page.getByText(/will not be shown on any restaurant/i),
  ).toHaveCount(0);
  await page
    .getByRole("textbox", { name: /^display name$/i })
    .fill("  mustafa   VURAL ");
  await expect(
    page.getByText(/will not be shown on any restaurant/i),
  ).toBeVisible();
});
