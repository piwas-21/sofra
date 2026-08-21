import { expect, test } from "./helpers/fixtures";
import { required } from "./helpers/flows";
import { findBackupAlerts } from "./helpers/db";

// The sweep that tells a human a restaurant's data is not protected (ADR-014 D5).
//
// The unit suite owns the judgement — when a situation is worth a mail, and when it
// has already been said. What only a real database and a real registry can show is
// the rule that keeps the alarm honest when the MAIL PATH itself is broken: a send
// that did not leave writes NO marker, so the next sweep tries again instead of
// treating its own silence as "already told him".
//
// Nothing is mocked. `RESEND_API_KEY` is blank in this suite (scripts/e2e-suite.sh),
// so the send comes back `{sent:false}` — which is exactly the condition under test,
// and the reason this spec exists rather than a unit test with a stubbed sender.
//
// The fixture registry lists active tenants that no box has ever reported an artifact
// for, so the platform state here is reliably `critical` whatever else the suite is
// doing in parallel. Nothing in this spec depends on WHICH tenants those are.

const CRON_URL = "/api/cron/backup-alerts";

test("the sweep endpoint is not an open relay", async ({ page }) => {
  // It SENDS MAIL from our verified domain. An unauthenticated caller who can make it
  // send is an open relay for send.sofrapiwas.com, and its reputation is what makes
  // every other company mail arrive at all.
  expect((await page.request.post(CRON_URL)).status()).toBe(401);
  const wrong = await page.request.post(CRON_URL, {
    headers: { Authorization: "Bearer not-the-cron-secret" },
  });
  expect(wrong.status()).toBe(401);
});

test("a sweep that could not mail says so, and leaves no marker behind", async ({ page }) => {
  const res = await page.request.post(CRON_URL, {
    headers: { Authorization: `Bearer ${required("CRON_SECRET")}` },
  });
  expect(res.status()).toBe(200);

  // 200 even though nothing was sent, on purpose: the sweep RAN. `skipped` is what
  // the workflow fails its run on, and a 500 here would be indistinguishable from the
  // container being down.
  const body = await res.json();
  expect(body).toMatchObject({ level: "critical", emailed: false, skipped: "sendFailed" });
  // Counts only — never a recipient address, never a mail body (CLAUDE.md §5.8).
  expect(body.watched).toBeGreaterThan(0);
  expect(body).not.toHaveProperty("to");

  // The rule this spec exists for. No marker means the NEXT sweep still reads "not
  // yet said" and tries again — the opposite of the trial-warning sweep, which marks
  // a failed send deliberately because re-mailing a PARTNER is the worse mistake.
  expect(await findBackupAlerts()).toHaveLength(0);

  // And it is genuinely repeatable: a second run behaves identically rather than
  // going quiet on the strength of the first.
  const again = await page.request.post(CRON_URL, {
    headers: { Authorization: `Bearer ${required("CRON_SECRET")}` },
  });
  expect(await again.json()).toMatchObject({ decision: "new", skipped: "sendFailed" });
});
