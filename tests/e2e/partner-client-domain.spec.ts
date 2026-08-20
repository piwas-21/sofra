import { expect, test } from "./helpers/fixtures";
import { RUN_ID, login, uniq } from "./helpers/flows";
import {
  arrangeAdminUser,
  arrangeBaseDomain,
  arrangeResellerClient,
  findAuditEntries,
} from "./helpers/db";

// Where a reseller's restaurant will live, chosen by the PARTNER before the tenant
// exists (SOFRA-PARTNER-FLEXIBILITY-PLAN D2).
//
// The boundary these cases exist to hold is that a partner PROPOSES and nothing more:
// no registry write, no module change, no plan change (ADR-003/007, and #163 kept the
// same line). What lands is a note on the client, a founder mail, and an audit row —
// and, on the partner's screen, the exact A record they now have to publish.

const PASSWORD = "e2e-clientdomain-pass-1234";
const BASE_DOMAIN = `e2e-${RUN_ID}.example.com`;

test("a partner proposes their own zone, and is handed the record to publish", async ({ page }) => {
  const email = uniq.email("cdzone");
  const { partnerId, clientId } = await arrangeResellerClient({
    partnerEmail: email,
    partnerPassword: PASSWORD,
    restaurantName: "E2E Bresse Zone",
    status: "AGREED",
  });
  // ARRANGED verified, because proving it means publishing TXT in a zone we do not own
  // — see partner-base-domain.spec.ts for why the suite never fakes that check itself.
  await arrangeBaseDomain(partnerId, BASE_DOMAIN, { verified: true });

  await login(page, { email, password: PASSWORD });
  await page.waitForURL("**/dashboard");
  await page.goto(`/dashboard/clients/${clientId}`);

  await expect(page.getByRole("heading", { name: /where should this restaurant live/i })).toBeVisible();
  // The slug is pre-filled from the restaurant name — a suggestion, still editable.
  await expect(page.getByLabel(/short name/i)).toHaveValue("e2e-bresse-zone");

  await page.getByRole("radio", { name: /under your own domain/i }).check();
  await page.getByLabel(/short name/i).fill("obresse");
  await page.getByRole("button", { name: /send this proposal/i }).click();

  // The hostname is printed from the SERVER's resolved answer, not from the radio.
  await expect(page.getByText(`obresse.${BASE_DOMAIN}`).first()).toBeVisible();
  // And the trap the whole feature turns on: the record has to exist BEFORE we build.
  await expect(page.getByText(/has to be live BEFORE we set the restaurant up/i)).toBeVisible();
  await expect(page.getByLabel(/^Name$/)).toHaveValue(`obresse.${BASE_DOMAIN}`);

  // Durable whatever the mail did: the proposal is a note on the client, written in the
  // registry's own field names so the founder transcribes rather than interprets.
  await expect(page.getByText(`domain: obresse.${BASE_DOMAIN}`)).toBeVisible();
  await expect(page.getByText(`base_domain: ${BASE_DOMAIN}`)).toBeVisible();

  const audits = await findAuditEntries("client.domain_proposed", clientId);
  expect(audits).toHaveLength(1);
  expect(audits[0].meta).toMatchObject({ choice: "partnerBase", domain: `obresse.${BASE_DOMAIN}` });
});

test("the default costs the partner no DNS at all", async ({ page }) => {
  const email = uniq.email("cdsofra");
  const { clientId } = await arrangeResellerClient({
    partnerEmail: email,
    partnerPassword: PASSWORD,
    restaurantName: "E2E Bresse Default",
    status: "AGREED",
  });

  await login(page, { email, password: PASSWORD });
  await page.waitForURL("**/dashboard");
  await page.goto(`/dashboard/clients/${clientId}`);
  await page.getByLabel(/short name/i).fill("e2e-default-pick");
  await page.getByRole("button", { name: /send this proposal/i }).click();

  await expect(page.getByText("domain: e2e-default-pick.sofrapiwas.com")).toBeVisible();
  await expect(page.getByText(/already points at us/i)).toBeVisible();
});

test("a partner with no verified zone is shown the way to one, not a dead control", async ({
  page,
}) => {
  const email = uniq.email("cdnobase");
  const { partnerId, clientId } = await arrangeResellerClient({
    partnerEmail: email,
    partnerPassword: PASSWORD,
    restaurantName: "E2E Bresse Unproven",
    status: "AGREED",
  });
  // Claimed but NOT proven — the state that must be inert everywhere (D1b).
  await arrangeBaseDomain(partnerId, `unproven-${BASE_DOMAIN}`);

  await login(page, { email, password: PASSWORD });
  await page.waitForURL("**/dashboard");
  await page.goto(`/dashboard/clients/${clientId}`);

  await expect(page.getByRole("radio", { name: /under your own domain/i })).toBeDisabled();
  await expect(page.getByText(/no verified domain yet/i)).toBeVisible();
  // An unproven zone is not merely unselectable — it is not named at all.
  await expect(page.getByText(`unproven-${BASE_DOMAIN}`)).toHaveCount(0);
});

test("buying a domain through us is shown as unavailable, and refused if forced", async ({
  page,
}) => {
  const email = uniq.email("cdbuy");
  const { clientId } = await arrangeResellerClient({
    partnerEmail: email,
    partnerPassword: PASSWORD,
    restaurantName: "E2E Bresse Buy",
    status: "AGREED",
  });

  await login(page, { email, password: PASSWORD });
  await page.waitForURL("**/dashboard");
  await page.goto(`/dashboard/clients/${clientId}`);

  const buy = page.getByRole("radio", { name: /buy a domain through us/i });
  await expect(buy).toBeDisabled();

  // A disabled radio is a client-side fact. Re-enable it exactly as a stale bundle or a
  // crafted POST would, and the SERVER must still refuse — blocked on domainio#231, a
  // domain we could register and then not point anywhere.
  await buy.evaluate((el) => el.removeAttribute("disabled"));
  await buy.check();
  await page.getByLabel(/short name/i).fill("e2e-buy-attempt");
  await page.getByRole("button", { name: /send this proposal/i }).click();

  await expect(page.getByText(/isn't available yet/i)).toBeVisible();
  expect(await findAuditEntries("client.domain_proposed", clientId)).toHaveLength(0);
});

test("once the restaurant is set up, the chooser is gone", async ({ page }) => {
  const email = uniq.email("cdlive");
  const { clientId } = await arrangeResellerClient({
    partnerEmail: email,
    partnerPassword: PASSWORD,
    restaurantName: "E2E Bresse Live",
    status: "LIVE",
    tenantSlug: "e2e-domain-live",
    plan: { amountCents: 4500, interval: "1 month", subStatus: "ACTIVE" },
  });

  await login(page, { email, password: PASSWORD });
  await page.waitForURL("**/dashboard");
  await page.goto(`/dashboard/clients/${clientId}`);

  // Past this point the domain is baked into a per-domain image, so changing it is a
  // rebuild plus a re-provision — a conversation for the change-request form below,
  // not a one-click chooser.
  await expect(page.getByRole("heading", { name: /where should this restaurant live/i })).toHaveCount(0);
  await expect(page.getByRole("heading", { name: /ask for a change/i })).toBeVisible();
  expect(clientId).toBeTruthy();
});

test("the founder can place a tenant under a proven partner zone, and sees whose it is", async ({
  page,
}) => {
  const partnerEmail = uniq.email("cdadmin");
  const { partnerId } = await arrangeResellerClient({
    partnerEmail,
    partnerPassword: PASSWORD,
    restaurantName: "E2E Bresse Founder",
    status: "AGREED",
  });
  const proven = `founder-${BASE_DOMAIN}`;
  await arrangeBaseDomain(partnerId, proven, { verified: true });
  await arrangeBaseDomain(partnerId, `founder-unproven-${BASE_DOMAIN}`);

  // Its own ADMIN: `login:email:<address>` is 10 per 15 minutes and counts failures,
  // so a founder-only assertion never spends the shared account's headroom.
  const founder = uniq.email("cdfounder");
  await arrangeAdminUser(founder, PASSWORD);
  await login(page, { email: founder, password: PASSWORD });
  await page.waitForURL("**/admin");
  await page.goto("/admin/provision");

  const picker = page.getByLabel(/^Base domain$/);
  // The default is ours and it is FIRST, which is what keeps "absent base_domain emits
  // exactly today's entry" the path of least resistance rather than a choice.
  await expect(picker).toHaveValue("");
  // Proven zones are offered WITH their owner, so a plausible-looking name from the
  // wrong company cannot be picked by accident. An unproven one is not offered at all.
  // Domain AND owner in one option label — the pairing is the assertion, because the
  // suite runs several partners and a bare owner name matches more than one of them.
  await expect(
    picker.getByRole("option", { name: `${proven} — E2E Reseller` }),
  ).toHaveCount(1);
  await expect(picker.getByRole("option", { name: /founder-unproven-/ })).toHaveCount(0);

  // The preview is the cheapest place to catch a wrong IMMUTABLE identifier: slug and
  // base sit in different halves of the form and only compose in the hostname.
  await page.locator('input[name="slug"]').fill("obresse");
  await picker.selectOption(proven);
  await expect(page.getByText(`obresse.${proven}`)).toBeVisible();
  await expect(page.getByText(/must already resolve before you merge/i)).toBeVisible();
});
