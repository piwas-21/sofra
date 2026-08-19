import { expect, test } from "./helpers/fixtures";
import { RUN_ID, uniq } from "./helpers/flows";
import { arrangeResellerClient, findTrial, findTrialWarnings } from "./helpers/db";

// The sweep that warns a payer their free period is ending, and the founder before
// them (workspace docs/plans/SOFRA-PARTNER-FLEXIBILITY-PLAN.md, T-d).
//
// The property under test is IDEMPOTENCE, and it is not observable in one run: the
// whole risk of a `schedule:` job is that GitHub fires it twice, or that an operator
// re-runs it by hand. So the sweep is POSTed TWICE against a real database, and what
// is asserted is that the second run adds nothing. A unit test cannot show this — the
// marker it turns on is an audit ROW, written after the send.
//
// Nothing is mocked. `RESEND_API_KEY` is blank in this suite (scripts/e2e-suite.sh),
// so every send comes back `{sent:false}` and the marker is written anyway with
// `emailed: false` — which is the documented behaviour, and the reason it is safe:
// re-warning a partner on every later sweep is worse than one missed mail the founder
// can see in the log and re-send by hand.
//
// Each plan gets its OWN registry slug: `TenantBilling.tenantSlug` is UNIQUE, and
// sharing one across specs is a cross-spec race under parallel workers.

const PASSWORD = `e2e-warn-${RUN_ID}`;
const CRON_URL = "/api/cron/trial-warnings";

/** Days out, at the end of that UTC day — the shape `defaultTrialEnd` writes. */
function trialEnd(daysFromNow: number): string {
  const d = new Date(Date.now() + daysFromNow * 24 * 60 * 60 * 1000);
  d.setUTCHours(23, 59, 59, 999);
  return d.toISOString();
}

function cronSecret(): string {
  const secret = process.env.CRON_SECRET;
  // A hard error, not a skip: without the secret this spec would 401 on every call
  // and could report green having exercised nothing at all.
  if (!secret) throw new Error("CRON_SECRET must be set to run the trial-warning spec");
  return secret;
}

test("the sweep endpoint is not an open relay", async ({ page }) => {
  // It SENDS MAIL from our verified domain. An unauthenticated caller who can make it
  // send is an open relay for send.sofrapiwas.com, and its reputation is what makes
  // every other company mail arrive at all.
  const anonymous = await page.request.post(CRON_URL);
  expect(anonymous.status()).toBe(401);

  const wrong = await page.request.post(CRON_URL, {
    headers: { Authorization: "Bearer not-the-cron-secret" },
  });
  expect(wrong.status()).toBe(401);
});

test("a partner is warned once, and a second sweep says nothing more", async ({ page }) => {
  await arrangeResellerClient({
    partnerEmail: uniq.email("warn"),
    partnerPassword: PASSWORD,
    restaurantName: "E2E Warning Bistro",
    status: "LIVE",
    tenantSlug: "e2e-trial-warn",
    plan: {
      amountCents: 4500,
      interval: "1 month",
      subStatus: "PENDING",
      // Three days out: inside BOTH the founder's fortnight and the payer's week, so
      // one sweep produces both mails — and the founder's is sent first.
      trialEndsAtIso: trialEnd(3),
    },
  });
  const plan = await findTrial("e2e-trial-warn");
  const headers = { Authorization: `Bearer ${cronSecret()}` };

  const first = await page.request.post(CRON_URL, { headers });
  expect(first.status()).toBe(200);
  // Counts only in the response — never an address (CLAUDE.md §5.8).
  expect(await first.json()).toMatchObject({ considered: expect.any(Number) });

  const afterFirst = await findTrialWarnings(plan!.billingId);
  expect(afterFirst.map((r) => r.action).sort()).toEqual([
    "billing.trial.ending.founder",
    "billing.trial.ending.soon",
  ]);
  // The marker carries the DATE it was written about, which is what lets an extension
  // re-arm the warnings later — and the send verdict, so "was anyone actually told?"
  // is answerable from the log rather than inferred from an absence.
  for (const row of afterFirst) {
    expect(row.meta).toMatchObject({
      tenantSlug: "e2e-trial-warn",
      endsOn: plan!.trialEndsAt!.toISOString().slice(0, 10),
      phase: "soon",
      emailed: false,
    });
  }

  // The whole point. A schedule that fires twice, or an operator re-running the
  // workflow, must not tell a partner the same thing again.
  const second = await page.request.post(CRON_URL, { headers });
  expect(second.status()).toBe(200);
  expect(await second.json()).toMatchObject({ founderNotices: 0, payerWarnings: 0 });
  expect(await findTrialWarnings(plan!.billingId)).toHaveLength(afterFirst.length);
});

test("a plan that is already paying is never warned about its free period", async ({ page }) => {
  // Derived from the same `planState` the dashboard renders: an ACTIVE subscription is
  // charging, whatever its trial column still says. A second opinion here is how the
  // mail and the page end up disagreeing about whether money is owed.
  await arrangeResellerClient({
    partnerEmail: uniq.email("warnactive"),
    partnerPassword: PASSWORD,
    restaurantName: "E2E Paying Bistro",
    status: "LIVE",
    tenantSlug: "e2e-trial-warn-active",
    plan: {
      amountCents: 4500,
      interval: "1 month",
      subStatus: "ACTIVE",
      trialEndsAtIso: trialEnd(2),
    },
  });
  // And one that is genuinely in trial, but nowhere near the end: the window is a
  // window at both ends, so a partner is not nagged from the day they are onboarded.
  await arrangeResellerClient({
    partnerEmail: uniq.email("warnearly"),
    partnerPassword: PASSWORD,
    restaurantName: "E2E Early Bistro",
    status: "LIVE",
    tenantSlug: "e2e-trial-warn-early",
    plan: {
      amountCents: 4500,
      interval: "1 month",
      subStatus: "PENDING",
      trialEndsAtIso: trialEnd(28),
    },
  });

  const paying = await findTrial("e2e-trial-warn-active");
  const early = await findTrial("e2e-trial-warn-early");
  const res = await page.request.post(CRON_URL, {
    headers: { Authorization: `Bearer ${cronSecret()}` },
  });
  expect(res.status()).toBe(200);

  expect(await findTrialWarnings(paying!.billingId)).toHaveLength(0);
  expect(await findTrialWarnings(early!.billingId)).toHaveLength(0);
});
