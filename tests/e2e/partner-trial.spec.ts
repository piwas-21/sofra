import { expect, test } from "./helpers/fixtures";
import { login, RUN_ID, uniq } from "./helpers/flows";
import {
  arrangeAdminUser,
  arrangeResellerClient,
  findAuditEntries,
  findTrial,
} from "./helpers/db";

// The free period a partner gets on a tenant they sold
// (workspace docs/plans/SOFRA-PARTNER-FLEXIBILITY-PLAN.md, T-b).
//
// The behaviour under test is a NEGATIVE one — no pay button — which is exactly the
// kind that rots silently, so it is asserted on all three surfaces a reseller reads:
// the dashboard hero, the client page and their billing book. Those were three
// separate renderings of one money question before this change; a spec that checked
// only one of them would pass while another went on asking a partner for money the
// owner had said not to ask for.
//
// Nothing is mocked and nothing is stubbed: the plan is a real PENDING row with a
// real `trialEndsAt`, and every rule between that column and the page is production
// code. Each state gets its OWN registry slug — `TenantBilling.tenantSlug` is UNIQUE,
// and sharing one across specs is a cross-spec race under parallel workers.

// Derived from the run id rather than written as a literal: a `const PASSWORD = "…"`
// line is a gitleaks `generic-api-key` hit (entropy, not meaning), and a scan that
// cries wolf on a test fixture is a scan people learn to skip past.
const PASSWORD = `e2e-trial-${RUN_ID}`;

/** Days out, at the end of that UTC day — the shape `defaultTrialEnd` writes. */
function trialEnd(daysFromNow: number): string {
  const d = new Date(Date.now() + daysFromNow * 24 * 60 * 60 * 1000);
  d.setUTCHours(23, 59, 59, 999);
  return d.toISOString();
}

/** How the app prints a date (`shortDate`), so the assertion reads the real one. */
function shortDate(iso: string): string {
  return new Intl.DateTimeFormat("en-GB", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  }).format(new Date(iso));
}

const PAY_BUTTON = /start auto-monthly payment/i;

test("a partner inside the free period is told until when, and is never asked to pay", async ({
  page,
}) => {
  const email = uniq.email("trial");
  const endsAt = trialEnd(20);
  await arrangeResellerClient({
    partnerEmail: email,
    partnerPassword: PASSWORD,
    restaurantName: "E2E Trial Bistro",
    status: "LIVE",
    tenantSlug: "e2e-partner-trial",
    // PENDING with no payment — the state that used to show a pay button on sight.
    plan: {
      amountCents: 4500,
      interval: "1 month",
      subStatus: "PENDING",
      trialEndsAtIso: endsAt,
    },
  });
  await login(page, { email, password: PASSWORD });
  await page.waitForURL("**/dashboard");

  // 1. The dashboard hero: the sentence, and no button.
  await expect(page.getByText(`Free until ${shortDate(endsAt)}`)).toBeVisible();
  await expect(page.getByRole("button", { name: PAY_BUTTON })).toHaveCount(0);
  // The row line tells the state at a glance too, without opening anything.
  await expect(page.getByText("free period")).toBeVisible();

  // 2. The client page — the same verdict, from the same `planState`.
  await page.getByRole("link", { name: /E2E Trial Bistro/ }).click();
  await page.waitForURL(/\/dashboard\/clients\//);
  await expect(page.getByText(`Free until ${shortDate(endsAt)}`)).toBeVisible();
  await expect(page.getByRole("button", { name: PAY_BUTTON })).toHaveCount(0);
  // What it will cost is still shown: free until a date is not the same as free.
  await expect(page.getByText(/45,00/)).toBeVisible();

  // 3. The reseller's billing book, which kept its own copy of this decision until
  //    T-b made it render the shared control.
  await page.goto("/dashboard/billing");
  await expect(page.getByText(`Free until ${shortDate(endsAt)}`)).toBeVisible();
  await expect(page.getByRole("button", { name: PAY_BUTTON })).toHaveCount(0);
});

test("once the free period has passed, the ask comes back and nothing else happens", async ({
  page,
}) => {
  const email = uniq.email("expired");
  await arrangeResellerClient({
    partnerEmail: email,
    partnerPassword: PASSWORD,
    restaurantName: "E2E Expired Bistro",
    status: "LIVE",
    tenantSlug: "e2e-partner-expired",
    plan: {
      amountCents: 4500,
      interval: "1 month",
      subStatus: "PENDING",
      trialEndsAtIso: trialEnd(-2),
    },
  });
  await login(page, { email, password: PASSWORD });
  await page.waitForURL("**/dashboard");

  // The free-period sentence is gone, and the plan is payable again. What is offered
  // is the billing-details step, because this partner has no invoicing identity on
  // file — the B5 gate, unchanged by the trial and reached only once it ends.
  await expect(page.getByText(/free until/i)).toHaveCount(0);
  await expect(page.getByRole("link", { name: /add your billing details/i })).toBeVisible();

  // And that is ALL that happens on expiry (O-T2, "nothing automatic in v1"): the
  // tenant is not suspended, no card is charged, nothing nags. The client page still
  // shows a live restaurant.
  await page.getByRole("link", { name: /E2E Expired Bistro/ }).click();
  await page.waitForURL(/\/dashboard\/clients\//);
  await expect(
    page.getByRole("link", { name: "e2e-partner-expired.example.test" }),
  ).toBeVisible();
});

test("the founder can push a trial out, with a reason, and can never pull one in", async ({
  page,
}) => {
  const partnerEmail = uniq.email("extend");
  const adminEmail = uniq.email("founder");
  const endsAt = trialEnd(10);
  await arrangeResellerClient({
    partnerEmail,
    partnerPassword: PASSWORD,
    restaurantName: "E2E Extend Bistro",
    status: "LIVE",
    tenantSlug: "e2e-partner-extend",
    plan: {
      amountCents: 4500,
      interval: "1 month",
      subStatus: "PENDING",
      trialEndsAtIso: endsAt,
    },
  });
  await arrangeAdminUser(adminEmail, PASSWORD);
  const before = await findTrial("e2e-partner-extend");
  expect(before?.trialEndsAt).not.toBeNull();

  await login(page, { email: adminEmail, password: PASSWORD });
  await page.waitForURL("**/admin");

  // The founder's list says which trials are running — the answer to "why has this
  // tenant never paid", on the page where that question is asked.
  await page.goto("/admin/billing");
  await expect(page.getByText(`free until ${shortDate(endsAt)}`)).toBeVisible();

  await page.goto(`/admin/billing/${before!.billingId}`);

  // Shortening is refused by the server, not merely hidden by the date input's `min`:
  // a trial that can be pulled in is a restaurant charged in September after being
  // told October.
  const earlier = new Date(new Date(endsAt).getTime() - 5 * 24 * 60 * 60 * 1000);
  // Strip the input's own `min` first. That attribute is friction — one line of
  // devtools removes it — and the claim under test is that the SERVER refuses, not
  // that the browser declines to submit.
  await page.evaluate(() =>
    document.querySelector('input[name="trialEndsAt"]')?.removeAttribute("min"),
  );
  await page.fill('input[name="trialEndsAt"]', earlier.toISOString().slice(0, 10));
  await page.fill('input[name="reason"]', "trying to shorten it");
  await page.getByRole("button", { name: /extend free period/i }).click();
  await expect(page.getByText(/can only be extended/i)).toBeVisible();
  expect((await findTrial("e2e-partner-extend"))?.trialEndsAt?.toISOString()).toBe(
    before!.trialEndsAt!.toISOString(),
  );

  // Pushing it out works, and is recorded with the reason.
  const later = new Date(new Date(endsAt).getTime() + 30 * 24 * 60 * 60 * 1000);
  const laterDay = later.toISOString().slice(0, 10);
  await page.fill('input[name="trialEndsAt"]', laterDay);
  await page.fill('input[name="reason"]', "restaurant still deciding — agreed with Mustafa");
  await page.getByRole("button", { name: /extend free period/i }).click();
  await expect(page.getByText(/saved/i)).toBeVisible();

  const after = await findTrial("e2e-partner-extend");
  // End of the named UTC day: the whole of the day the founder picked is free.
  expect(after?.trialEndsAt?.toISOString()).toBe(`${laterDay}T23:59:59.999Z`);

  // The column says until when; only the audit log says why, and it carries BOTH
  // dates — the one thing a refund conversation a quarter later needs.
  const entries = await findAuditEntries("billing.trial.extended", before!.billingId);
  expect(entries).toHaveLength(1);
  expect(entries[0].meta).toMatchObject({
    tenantSlug: "e2e-partner-extend",
    from: before!.trialEndsAt!.toISOString(),
    to: `${laterDay}T23:59:59.999Z`,
    reason: "restaurant still deciding — agreed with Mustafa",
  });
});

test("a partner cannot reach the control that extends their own trial", async ({ page }) => {
  const email = uniq.email("noextend");
  await arrangeResellerClient({
    partnerEmail: email,
    partnerPassword: PASSWORD,
    restaurantName: "E2E No Extend",
    status: "LIVE",
    tenantSlug: "e2e-partner-noextend",
    plan: {
      amountCents: 4500,
      interval: "1 month",
      subStatus: "PENDING",
      trialEndsAtIso: trialEnd(5),
    },
  });
  const plan = await findTrial("e2e-partner-noextend");
  await login(page, { email, password: PASSWORD });
  await page.waitForURL("**/dashboard");

  // Free product, if this were reachable. `requireAdmin()` sends a partner away from
  // the page, and the action behind the form guards itself again (ADR-008).
  await page.goto(`/admin/billing/${plan!.billingId}`);
  await expect(page).not.toHaveURL(/\/admin\/billing\//);
  await expect(page.getByRole("button", { name: /extend free period/i })).toHaveCount(0);
});
