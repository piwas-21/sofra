import { expect, test } from "./helpers/fixtures";
import { required } from "./helpers/flows";

// One credential per BOX, not per environment (ADR-014 D1a).
//
// The property under test cannot be shown with a wrong token — a wrong token is
// refused for the ordinary reason. It needs a bearer that is genuinely VALID and
// belongs to somebody else, which is why the suite mints a second box's secret
// (`BACKUP_AGENT_SECRET_E2E_OTHER_BOX`, scripts/e2e-suite.sh).
//
// What it protects: the inventory push PRUNES what it stops listing, so a box able
// to push AS ANOTHER BOX can erase the control plane's whole record of that box's
// backups — leaving the page and the alarm both saying the opposite of the truth.

const INGEST = "/api/telemetry/backups";
const OTHER_BOX = "e2e-other-box";

const otherBoxAuth = () => ({
  Authorization: `Bearer ${required("BACKUP_AGENT_SECRET_E2E_OTHER_BOX")}`,
});

const inventory = (box: string) => ({ box, reportedAt: new Date().toISOString(), artifacts: [] });

test("a valid agent bearer cannot push an inventory for a box it is not", async ({ page }) => {
  const res = await page.request.post(INGEST, {
    headers: otherBoxAuth(),
    data: inventory("e2e-backup-box"),
  });
  // 403, not 401: the credential is real, it is simply not that box's.
  expect(res.status()).toBe(403);
  // And it says nothing about what the other box holds — an agent that
  // mis-authenticated must not learn the shape of the environment it reached.
  expect(await res.json()).toEqual({ error: "box mismatch" });
});

test("…and cannot claim another box's jobs either", async ({ page }) => {
  const res = await page.request.get(`/api/backups/jobs?box=e2e-backup-box`, {
    headers: otherBoxAuth(),
  });
  // Claiming LEASES: a lease taken by the wrong box is work the right one never runs.
  expect(res.status()).toBe(403);
});

test("its OWN box still works — the mechanism is a binding, not a block", async ({ page }) => {
  const res = await page.request.post(INGEST, {
    headers: otherBoxAuth(),
    data: inventory(OTHER_BOX),
  });
  expect(res.status()).toBe(200);
  // Counts only in the response — never a path, a ref or a slug.
  expect(await res.json()).toMatchObject({ ok: true });
});

test("a bearer this control plane does not hold is refused outright", async ({ page }) => {
  // Including the RETIRED shared secret, which both boxes still hold in their own
  // .env for their own agent. A box whose per-box value was never configured here
  // gets 401 and then goes quiet — which the backup alarm reports. Loud, in the
  // surface built to be loud.
  const res = await page.request.post(INGEST, {
    headers: { Authorization: "Bearer a-secret-this-control-plane-never-had" },
    data: inventory(OTHER_BOX),
  });
  expect(res.status()).toBe(401);
});
