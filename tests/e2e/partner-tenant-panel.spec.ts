import { expect, test } from "./helpers/fixtures";
import { login, uniq } from "./helpers/flows";
import { arrangeResellerClient } from "./helpers/db";

// The partner's own view of a tenant they sold (SOFRA-PARTNER-PLAN §9).
//
// The gap this closes was measured with a real reseller in the room on 2026-08-19: once
// a client reaches ONBOARDING/LIVE the pipeline control locks itself (the founder owns
// the status from there) and what was left was an edit form and a notes box — no slug,
// no address, no modules, no plan. "Nothing is manageable from the partner page."
//
// Nothing is mocked. The registry is the suite's own fixture (`e2e-partner-live` is an
// ACTIVE entry with core + reservations + online-payments, two languages, CHF and the
// craft template), which is what makes "the panel reads the registry" an assertion
// rather than a restatement of a constant.

const PASSWORD = "e2e-reseller-pass-1234";

test("a live client shows its tenant, what it includes and what it costs", async ({ page }) => {
  const email = uniq.email("reseller");
  await arrangeResellerClient({
    partnerEmail: email,
    partnerPassword: PASSWORD,
    restaurantName: "E2E Bresse",
    status: "LIVE",
    tenantSlug: "e2e-partner-live",
    plan: { amountCents: 4500, interval: "1 month", subStatus: "ACTIVE" },
  });
  await login(page, { email, password: PASSWORD });
  await page.waitForURL("**/dashboard");

  // The row line: a live paying restaurant must be tellable from a lead at a glance.
  await expect(page.getByText("e2e-partner-live.example.test")).toBeVisible();
  await expect(page.getByText(/plan active/i)).toBeVisible();

  await page.getByRole("link", { name: /E2E Bresse/ }).click();
  await page.waitForURL(/\/dashboard\/clients\//);

  // The live address, as a real outbound link — the registry's domain, not a guess.
  await expect(page.getByRole("link", { name: "e2e-partner-live.example.test" })).toHaveAttribute(
    "href",
    "https://e2e-partner-live.example.test",
  );
  // Registry facts, not defaults: this entry is CHF, two languages and the craft look.
  await expect(page.getByText("CHF")).toBeVisible();
  await expect(page.getByText("English, Français")).toBeVisible();
  await expect(page.getByText("Craft", { exact: true })).toBeVisible();
  // Modules as human names + what they unlock, never the raw registry ids.
  await expect(page.getByText("Online payments", { exact: true })).toBeVisible();
  await expect(page.getByText(/paid into your own Stripe account/i)).toBeVisible();
  // The plan the partner is charged for this restaurant.
  await expect(page.getByRole("heading", { name: /what this costs you/i })).toBeVisible();
  await expect(page.getByText(/45,00/)).toBeVisible();
  // An ACTIVE plan is never offered a pay button — that is the double-charge trap.
  await expect(page.getByRole("button", { name: /start auto-monthly payment/i })).toHaveCount(0);
});

test("a partner can ask for a change, and it is kept as a note", async ({ page }) => {
  const email = uniq.email("upsell");
  await arrangeResellerClient({
    partnerEmail: email,
    partnerPassword: PASSWORD,
    restaurantName: "E2E Upsell",
    status: "LIVE",
    tenantSlug: "e2e-partner-note",
    plan: { amountCents: 1900, interval: "1 month", subStatus: "ACTIVE" },
  });
  await login(page, { email, password: PASSWORD });
  await page.waitForURL("**/dashboard");
  await page.getByRole("link", { name: /E2E Upsell/ }).click();
  await page.waitForURL(/\/dashboard\/clients\//);

  await page.getByLabel(/what should change/i).fill("They want reservations added.");
  await page.getByRole("button", { name: /send request/i }).click();

  await expect(page.getByText(/we'll come back to you/i)).toBeVisible();
  // Durable whatever the mail did: the request is a note on the client.
  await expect(page.getByText("They want reservations added.")).toBeVisible();
});

test("an onboarding client with no tenant yet says what is being waited on", async ({ page }) => {
  const email = uniq.email("waiting");
  await arrangeResellerClient({
    partnerEmail: email,
    partnerPassword: PASSWORD,
    restaurantName: "E2E Waiting",
    status: "ONBOARDING",
  });
  await login(page, { email, password: PASSWORD });
  await page.waitForURL("**/dashboard");
  await page.getByRole("link", { name: /E2E Waiting/ }).click();
  await page.waitForURL(/\/dashboard\/clients\//);

  // An empty panel is what this replaces — the wait gets a sentence.
  await expect(page.getByText(/setting this restaurant up/i)).toBeVisible();
  await expect(page.getByText(/no plan yet/i)).toBeVisible();
});

test("a partner cannot open another partner's client", async ({ page }) => {
  const mine = uniq.email("mine");
  const theirs = uniq.email("theirs");
  await arrangeResellerClient({
    partnerEmail: mine,
    partnerPassword: PASSWORD,
    restaurantName: "E2E Mine",
    status: "LIVE",
  });
  const other = await arrangeResellerClient({
    partnerEmail: theirs,
    partnerPassword: PASSWORD,
    restaurantName: "E2E Theirs",
    status: "LIVE",
  });

  await login(page, { email: mine, password: PASSWORD });
  await page.waitForURL("**/dashboard");
  await page.goto(`/dashboard/clients/${other.clientId}`);

  // `findFirst` is scoped by partnerId, so another partner's client does not exist.
  await expect(page.getByText(/E2E Theirs/)).toHaveCount(0);
  await expect(page.getByText(/could not be found/i)).toBeVisible();
});
