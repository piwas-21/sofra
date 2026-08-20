import { expect, test } from "./helpers/fixtures";
import { RUN_ID, login, uniq } from "./helpers/flows";
import {
  arrangeAdminUser,
  arrangeBaseDomain,
  arrangePartnerUser,
  findBaseDomain,
} from "./helpers/db";

// A partner registering a zone of their own, and proving it
// (SOFRA-PARTNER-FLEXIBILITY-PLAN D1/D1b).
//
// What this suite CAN prove: the claim is stored, the exact record to publish is shown,
// a refusal happens before any lookup, a check that finds nothing leaves the domain
// unusable, and one partner never sees another's zone.
//
// What it deliberately does NOT try to prove: a SUCCESSFUL verification. Satisfying it
// means publishing a TXT record in a zone we do not own — that is the entire point of
// the check, and any mechanism that let the suite fake it would be a mechanism that
// weakens the boundary in production too. The matching itself (chunked TXT strings,
// quotes, another vendor's records alongside ours, another partner's token) is covered
// exhaustively in tests/unit/base-domain-verification.test.ts, and the verified state's
// consequences are ARRANGED here.

const PASSWORD = "e2e-basedomain-pass-1234";

// A subdomain of a real, IANA-reserved name: `_sofra-verify.<this>` resolves to
// NXDOMAIN quickly rather than hanging. NOT `.test` — `normalizeBaseDomain` refuses
// special-use TLDs on purpose, so the suite's usual `example.test` habit would be
// testing the refusal, not the flow.
const claimable = (label: string) => `e2e-${label}-${RUN_ID}.example.com`;

test("a partner claims a domain and is told exactly what to publish", async ({ page }) => {
  const email = uniq.email("basedomain");
  const partnerId = await arrangePartnerUser(email, PASSWORD);
  const domain = claimable("claim");

  await login(page, { email, password: PASSWORD });
  await page.waitForURL("**/dashboard");
  await page.getByRole("link", { name: /domains/i }).first().click();
  await page.waitForURL("**/dashboard/domains");

  await page.getByLabel(/your domain/i).fill(domain);
  await page.getByRole("button", { name: /add domain/i }).click();

  // The claim exists, and it is INERT until proven.
  await expect(page.getByText(domain, { exact: true })).toBeVisible();
  await expect(page.getByText(/not verified yet/i)).toBeVisible();
  expect(await findBaseDomain(partnerId, domain)).toMatchObject({
    verified: false,
    checked: false,
  });

  // The exact record — name and value — as copyable fields, not prose.
  await expect(page.getByLabel(/^Name$/)).toHaveValue(`_sofra-verify.${domain}`);
  await expect(page.getByLabel(/^Value$/)).toHaveValue(/^sofra-verify=[0-9a-f]{64}$/);
});

test("a check that finds no record leaves the domain unusable, and says so", async ({ page }) => {
  const email = uniq.email("bdcheck");
  const partnerId = await arrangePartnerUser(email, PASSWORD);
  const domain = claimable("check");
  await arrangeBaseDomain(partnerId, domain);

  await login(page, { email, password: PASSWORD });
  // Wait for the login POST to land before navigating: a `goto` racing it arrives
  // unauthenticated and is bounced to /login.
  await page.waitForURL("**/dashboard");
  await page.goto("/dashboard/domains");
  await page.getByRole("button", { name: /check now/i }).click();

  // Two outcomes are legitimate here and they are the SAME news to the partner: the
  // record is not published (NXDOMAIN), or the resolver could not answer at all. What
  // must never happen is a claim turning verified without a record — asserted below.
  await expect(
    page.getByText(/could not find the record|could not look the domain up/i),
  ).toBeVisible();
  const after = await findBaseDomain(partnerId, domain);
  expect(after?.verified).toBe(false);
  // "Never looked" and "looked, nothing there" are different states, and only the
  // second one tells the partner their record has not landed rather than that they
  // forgot to press the button.
  expect(after?.checked).toBe(true);
});

test("our own zone is refused before any lookup happens", async ({ page }) => {
  const email = uniq.email("bdours");
  const partnerId = await arrangePartnerUser(email, PASSWORD);

  await login(page, { email, password: PASSWORD });
  // Wait for the login POST to land before navigating: a `goto` racing it arrives
  // unauthenticated and is bounced to /login.
  await page.waitForURL("**/dashboard");
  await page.goto("/dashboard/domains");
  await page.getByLabel(/your domain/i).fill("obresse.sofrapiwas.com");
  await page.getByRole("button", { name: /add domain/i }).click();

  await expect(page.getByText(/that domain is ours/i)).toBeVisible();
  expect(await findBaseDomain(partnerId, "obresse.sofrapiwas.com")).toBeNull();
});

test("a partner never sees another partner's zone", async ({ page }) => {
  const mine = uniq.email("bdmine");
  const theirs = uniq.email("bdtheirs");
  const mineId = await arrangePartnerUser(mine, PASSWORD);
  const theirsId = await arrangePartnerUser(theirs, PASSWORD);
  const myDomain = claimable("mine");
  const theirDomain = claimable("theirs");
  await arrangeBaseDomain(mineId, myDomain, { verified: true });
  await arrangeBaseDomain(theirsId, theirDomain, { verified: true });

  await login(page, { email: mine, password: PASSWORD });
  await page.waitForURL("**/dashboard");
  await page.goto("/dashboard/domains");

  await expect(page.getByText(myDomain, { exact: true })).toBeVisible();
  // Scoped by partnerId server-side, so the other partner's zone does not exist here.
  await expect(page.getByText(theirDomain, { exact: true })).toHaveCount(0);
});

test("the founder sees a partner's zones, and which proof has gone stale", async ({ page }) => {
  const email = uniq.email("bdfounder");
  const partnerId = await arrangePartnerUser(email, PASSWORD);
  const fresh = claimable("fresh");
  const stale = claimable("stale");
  const unproven = claimable("unproven");
  await arrangeBaseDomain(partnerId, fresh, { verified: true, verifiedDaysAgo: 3 });
  await arrangeBaseDomain(partnerId, stale, { verified: true, verifiedDaysAgo: 400 });
  await arrangeBaseDomain(partnerId, unproven);

  // Its own ADMIN rather than the seeded one: `login:email:<address>` is 10 per 15
  // minutes and counts failures, so a founder-only assertion brings its own account
  // instead of eating another spec's headroom (helpers/db.ts).
  const founder = uniq.email("bdadmin");
  await arrangeAdminUser(founder, PASSWORD);
  await login(page, { email: founder, password: PASSWORD });
  await page.waitForURL("**/admin");
  await page.goto(`/admin/partners/${partnerId}`);

  await expect(page.getByRole("heading", { name: /their own domains/i })).toBeVisible();
  // Nothing auto-revokes: a 400-day-old proof is still VERIFIED, and what the founder
  // gets is the prompt to ask — not a partner whose next client silently cannot be
  // placed (lib/base-domain-verification.ts).
  await expect(page.getByText(/3 days ago/)).toBeVisible();
  await expect(page.getByText(/400 days ago, worth re-confirming/)).toBeVisible();
  await expect(page.getByText(/not verified — unusable/)).toBeVisible();
  expect(await findBaseDomain(partnerId, stale)).toMatchObject({ verified: true });
  expect(await findBaseDomain(partnerId, unproven)).toMatchObject({ verified: false });
});
