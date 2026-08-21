import type { Page } from "@playwright/test";
import { expect, test } from "./helpers/fixtures";
import { login, uniq } from "./helpers/flows";
import { arrangeResellerClient } from "./helpers/db";

// The DNS a partner still has to publish, on the page where he manages the client.
//
// The failure this closes, measured on a live reseller 2026-08-21: the instruction
// existed ONLY as the transient answer to the domain chooser, and the chooser is
// hidden once `tenantSlug` is set. So the partner saw the record once, before the
// tenant existed, and never again — his client's certificate could not issue, and the
// product had no surface that said why. He asked us in a meeting.
//
// Two tests, because the panel has to be right in both directions: it must ASK when a
// record is genuinely owed, and it must stay QUIET when our wildcard already answers.
// A panel that nags every partner is one they learn to scroll past.
//
// `TENANT_BOX_IP` is unset in the suite, so the status reads "could not check" and no
// DNS query leaves the runner — deliberate: the record's IDENTITY is what this spec is
// about, and asserting on real resolution would make CI depend on the internet.

const PASSWORD = "e2e-dns-pass-1234";

// `label` must differ per test: `uniq.email` is stable within a run, so two tests
// sharing a label are two INSERTs of the same address — and under parallel workers
// that is a unique-constraint failure, not a flake.
async function openClientPage(
  page: Page,
  label: string,
  restaurantName: string,
  tenantSlug: string,
) {
  const email = uniq.email(label);
  await arrangeResellerClient({
    partnerEmail: email,
    partnerPassword: PASSWORD,
    restaurantName,
    status: "LIVE",
    tenantSlug,
  });
  await login(page, { email, password: PASSWORD });
  await page.waitForURL("**/dashboard");
  await page.getByRole("link", { name: new RegExp(restaurantName) }).click();
  await page.waitForURL(/\/dashboard\/clients\//);
}

test("a client under the partner's own zone is told exactly which record to publish", async ({
  page,
}) => {
  await openClientPage(page, "dns-zone", "E2E Zone Bistro", "e2e-partner-zone");

  const dns = page
    .locator("section")
    .filter({ has: page.getByRole("heading", { name: /DNS for this address/i }) });
  await expect(dns).toBeVisible();

  // WHOSE job it is, named by zone — a partner with several zones has to know which
  // editor to open, and "publish an A record" alone does not tell him.
  await expect(
    dns.getByText(/you publish this one, in the DNS for solutioneva\.example/i),
  ).toBeVisible();

  // The record itself. `getByLabel` rather than text: these are CopyField inputs, and
  // the label is the only thing that distinguishes name from value.
  await expect(dns.getByLabel("Name")).toHaveValue("e2e-partner-zone");
  // Zone editors disagree about what "name" means, so the whole hostname is printed
  // too — the guess this prevents creates e2e-partner-zone.e2e-partner-zone.<zone>.
  await expect(
    dns.getByText(/whole name instead: e2e-partner-zone\.solutioneva\.example/i),
  ).toBeVisible();

  // The alias rides OUR wildcard, so it is not something anyone must publish. If this
  // ever starts being listed, a partner is being sent to create a record in a zone he
  // does not control.
  await expect(dns.getByText("e2e-partner-zone.sofrapiwas.com")).toHaveCount(0);
});

test("a client on our own base domain is asked for nothing", async ({ page }) => {
  await openClientPage(page, "dns-ours", "E2E Ours Bistro", "e2e-partner-ours");

  // Anchor on a REGISTRY-derived fact, not just any heading: the tenant panel renders
  // its heading even when the registry is unreadable, and this spec asserts an ABSENCE
  // — so it has to prove the registry was actually read before the absence means
  // anything. (Learned the hard way: a duplicate fixture key made the whole registry
  // unparseable, and the "no DNS panel" assertion passed for entirely the wrong reason.)
  await expect(
    page.getByRole("link", { name: "e2e-partner-ours.sofrapiwas.com" }),
  ).toBeVisible();
  await expect(page.getByRole("heading", { name: /DNS for this address/i })).toHaveCount(0);
});
