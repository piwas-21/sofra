import { expect, test } from "./helpers/fixtures";
import { loginAsAdmin, required } from "./helpers/flows";
import {
  arrangeLapsedTrialPlan,
  findBackupArtifactRefs,
  findBackupJobs,
} from "./helpers/db";

// /admin/backups — the owner's window onto backups that already exist (ADR-014).
//
// Nothing is mocked. The real bearer-authed ingest receives a real inventory, the
// real page joins it against the real registry fixture, and the real job queue is
// polled through the real endpoint the box will poll. What a unit test cannot show
// is exactly what this covers: that the three machine endpoints refuse an
// anonymous caller, that a whole-box push PRUNES what it stops listing, and that a
// tenant with NO artifact is rendered rather than absent — the last being the one
// the whole feature exists for, and the one an ordinary "does it list things" test
// would pass without noticing.
//
// Its own box id (`e2e-backup-box`) and its own registry slugs: the push is
// whole-box and prunes, so a spec pushing against `staging` would delete another
// spec's rows on the way past, and `TenantBilling.tenantSlug` is UNIQUE.

const BOX = "e2e-backup-box";
const INGEST = "/api/telemetry/backups";
const JOBS = `/api/backups/jobs?box=${BOX}`;

function agentSecret(): string {
  // A hard error, not a skip: without the secret every call would 401 and the
  // spec would report green having exercised nothing at all.
  //
  // PER BOX since ADR-014 D1a — `BACKUP_AGENT_SECRET_<BOX>` for the box this spec
  // pushes as. There is no shared value to fall back on any more, which is the
  // point: a bearer is an identity, not a pass.
  return required("BACKUP_AGENT_SECRET_E2E_BACKUP_BOX");
}

const authHeaders = () => ({ Authorization: `Bearer ${agentSecret()}` });

const hoursAgo = (h: number) => new Date(Date.now() - h * 60 * 60 * 1000).toISOString();
const daysAgo = (d: number) => hoursAgo(d * 24);

/** The inventory the page is asserted against — one artifact per state it must
 *  tell apart. `e2e-backup-none` is deliberately absent from it. */
function fullInventory() {
  return {
    box: BOX,
    reportedAt: new Date().toISOString(),
    artifacts: [
      // Fresh, off-box, and with a second copy so it is not a "last copy".
      { tenantSlug: "e2e-backup-fresh", kind: "scheduled", takenAt: hoursAgo(6),
        sizeBytes: 18_874_368, location: "restic", ref: "fresh-restic-1", sha256: null },
      { tenantSlug: "e2e-backup-fresh", kind: "scheduled", takenAt: hoursAgo(30),
        sizeBytes: 18_000_000, location: "restic", ref: "fresh-restic-2", sha256: null },
      // Four days old: past the 72h threshold, so UNPROTECTED.
      { tenantSlug: "e2e-backup-stale", kind: "scheduled", takenAt: hoursAgo(96),
        sizeBytes: 1_048_576, location: "restic", ref: "stale-restic-1", sha256: null },
      // Fresh, and entirely on the box that runs it: green by every age rule and
      // gone with the box.
      { tenantSlug: "e2e-backup-local", kind: "scheduled", takenAt: hoursAgo(4),
        sizeBytes: 2048, location: "local", ref: "local-dump-1.sql.gz", sha256: null },
      // A lapsed trial with exactly ONE copy — both the retention sentence and
      // the last-copy refusal are asserted against this row.
      { tenantSlug: "e2e-backup-lapsed", kind: "scheduled", takenAt: daysAgo(2),
        sizeBytes: 4096, location: "restic", ref: "lapsed-restic-1", sha256: null },
      // No registry entry anywhere: the departed customer.
      { tenantSlug: "e2e-backup-departed", kind: "deprovision", takenAt: daysAgo(10),
        sizeBytes: 8192, location: "restic", ref: "departed-restic-1", sha256: null },
    ],
  };
}

test("the three machine endpoints are not open to an anonymous caller", async ({ page }) => {
  // An unauthenticated ingest is an information leak about every tenant we hold
  // data for: which restaurants exist, how large each database is, and which have
  // left. Not the data — the shape of the business, answered by a curl.
  for (const [method, url] of [
    ["post", INGEST],
    ["get", JOBS],
    ["post", "/api/backups/jobs/whatever/result"],
  ] as const) {
    const anonymous = await page.request[method](url, { data: {} });
    expect(anonymous.status(), `${method} ${url} anonymous`).toBe(401);

    const wrong = await page.request[method](url, {
      headers: { Authorization: "Bearer not-the-agent-secret" },
      data: {},
    });
    expect(wrong.status(), `${method} ${url} wrong bearer`).toBe(401);
  }
});

test("a malformed inventory is refused without echoing anything back", async ({ page }) => {
  const res = await page.request.post(INGEST, {
    headers: authHeaders(),
    data: { box: BOX, reportedAt: "not-a-date", artifacts: [{ tenantSlug: "NOT A SLUG" }] },
  });
  expect(res.status()).toBe(400);
  const body = await res.text();
  // Never the payload, and never the zod issue list — the issues name the fields
  // we expect, which is a free map of the contract.
  expect(body).not.toContain("NOT A SLUG");
  expect(body).not.toContain("tenantSlug");
});

test("the page shows what is protected and, first, what is not", async ({ page }) => {
  await arrangeLapsedTrialPlan("e2e-backup-lapsed", daysAgo(20));
  const push = await page.request.post(INGEST, { headers: authHeaders(), data: fullInventory() });
  expect(push.status()).toBe(200);
  // Counts only in the response — no path, no ref, no slug.
  expect(await push.json()).toMatchObject({ ok: true, artifacts: 6 });

  await loginAsAdmin(page);
  await page.goto("/admin/backups", { waitUntil: "domcontentloaded" });

  const card = (slug: string) => page.locator(`li[data-slug="${slug}"]`);

  // THE ASSERTION THIS PAGE EXISTS FOR: a registry tenant we hold nothing for is
  // present and shouting, rather than quietly absent from a list of successes.
  await expect(card("e2e-backup-none")).toHaveAttribute("data-health", "never");
  await expect(card("e2e-backup-none")).toContainText("NEVER BACKED UP");

  await expect(card("e2e-backup-stale")).toHaveAttribute("data-health", "unprotected");
  await expect(card("e2e-backup-fresh")).toHaveAttribute("data-health", "protected");

  // Fresh, green by every age rule, and gone with the box it sits on. A separate
  // alarm because it is a different kind of unprotected.
  await expect(card("e2e-backup-local")).toHaveAttribute("data-health", "protected");
  await expect(card("e2e-backup-local").getByRole("alert")).toContainText(
    /copy sits on the box/i,
  );
  await expect(card("e2e-backup-fresh").getByRole("alert")).toHaveCount(0);

  // The trial link — the sentence the owner asked for. A lapsed trial gets a date
  // and a countdown, not a shrug.
  await expect(card("e2e-backup-lapsed")).toContainText(/free period ended/i);
  await expect(card("e2e-backup-lapsed")).toContainText(/we still have their data until/i);

  // The departed customer: no registry entry, still holding their data, still
  // able to answer "yes, we have your menu — until".
  await expect(card("e2e-backup-departed")).toContainText(/No longer in the registry/i);
  await expect(card("e2e-backup-departed")).toContainText(/we still have their data until/i);
  // …and no "back up now", because there is no tenant left to back up.
  await expect(card("e2e-backup-departed").getByRole("button", { name: /back up now/i })).toHaveCount(0);
});

test("an artifact the box stops listing is removed, not remembered", async ({ page }) => {
  // The prune is the property that makes an emptied repository VISIBLE. Without
  // it, a repository that has quietly lost everything still renders green.
  await page.request.post(INGEST, { headers: authHeaders(), data: fullInventory() });
  expect(await findBackupArtifactRefs("e2e-backup-fresh")).toEqual([
    "fresh-restic-1",
    "fresh-restic-2",
  ]);

  const shrunk = fullInventory();
  shrunk.artifacts = shrunk.artifacts.filter((a) => a.ref !== "fresh-restic-2");
  const res = await page.request.post(INGEST, { headers: authHeaders(), data: shrunk });
  expect(await res.json()).toMatchObject({ removed: 1 });
  expect(await findBackupArtifactRefs("e2e-backup-fresh")).toEqual(["fresh-restic-1"]);

  // Another box's push must never touch this box's rows.
  await page.request.post(INGEST, {
    headers: authHeaders(),
    data: { box: "e2e-other-box", reportedAt: new Date().toISOString(), artifacts: [] },
  });
  expect(await findBackupArtifactRefs("e2e-backup-fresh")).toEqual(["fresh-restic-1"]);
});

test("the founder queues a backup and the box collects it on its next poll", async ({ page }) => {
  await page.request.post(INGEST, { headers: authHeaders(), data: fullInventory() });
  await loginAsAdmin(page);
  await page.goto("/admin/backups", { waitUntil: "domcontentloaded" });

  await page
    .locator('li[data-slug="e2e-backup-stale"]')
    .getByRole("button", { name: /back up now/i })
    .click();
  await expect(page.locator('li[data-slug="e2e-backup-stale"]')).toContainText(/Queued for/i);

  // The box's side of the contract, through the endpoint it will really call.
  const poll = await page.request.get(JOBS, { headers: authHeaders() });
  expect(poll.status()).toBe(200);
  const { jobs } = (await poll.json()) as {
    jobs: { id: string; action: string; tenantSlug: string; ref: string | null }[];
  };
  const job = jobs.find((j) => j.tenantSlug === "e2e-backup-stale");
  expect(job).toMatchObject({ action: "create", ref: null });

  const result = await page.request.post(`/api/backups/jobs/${job!.id}/result`, {
    headers: authHeaders(),
    data: {
      ok: true,
      artifact: {
        tenantSlug: "e2e-backup-stale",
        kind: "manual",
        takenAt: new Date().toISOString(),
        sizeBytes: 1024,
        location: "restic",
        ref: "stale-manual-1",
      },
    },
  });
  expect(result.status()).toBe(200);

  // The artifact the box handed back lands immediately, so the founder is not
  // waiting an hour for the next inventory push to see the thing he asked for.
  await page.reload({ waitUntil: "domcontentloaded" });
  await expect(page.locator('li[data-slug="e2e-backup-stale"]')).toHaveAttribute(
    "data-health",
    "protected",
  );
  await expect(page.locator('li[data-slug="e2e-backup-stale"]')).toContainText("stale-manual-1");
  expect((await findBackupJobs("e2e-backup-stale"))[0]).toMatchObject({
    action: "CREATE",
    status: "DONE",
  });
});

test("deleting a tenant's LAST copy is refused until it is explicitly overridden", async ({
  page,
}) => {
  // This whole surface is off unless BACKUP_DELETE_ENABLED=true — scripts/e2e-suite.sh
  // sets it precisely so the guards can be proven, and production leaves it unset.
  await arrangeLapsedTrialPlan("e2e-backup-lapsed", daysAgo(20));
  await page.request.post(INGEST, { headers: authHeaders(), data: fullInventory() });
  await loginAsAdmin(page);
  await page.goto("/admin/backups", { waitUntil: "domcontentloaded" });

  const artifact = page.locator('li[data-ref="lapsed-restic-1"]');
  await artifact.getByText(/delete this copy/i).click();

  // A slug typed for a DIFFERENT tenant is refused, even though the id in the
  // hidden field is correct — which is the entire reason the slug is typed.
  await artifact.locator('input[name="confirmSlug"]').fill("e2e-backup-fresh");
  await artifact.locator('input[name="reason"]').fill("customer asked for erasure");
  await artifact.getByRole("button", { name: /queue deletion/i }).click();
  await expect(artifact).toContainText(/does not match/i);

  // Right slug, real reason, override left unticked: still refused, because this
  // is the only copy of that restaurant's data.
  await artifact.locator('input[name="confirmSlug"]').fill("e2e-backup-lapsed");
  await artifact.locator('input[name="reason"]').fill("customer asked for erasure");
  await artifact.getByRole("button", { name: /queue deletion/i }).click();
  await expect(artifact).toContainText(/only copy/i);
  expect(await findBackupJobs("e2e-backup-lapsed")).toHaveLength(0);

  // With the override, it is queued — and the reason is on the row, because six
  // months from now "why is this gone?" has to be answerable from the log.
  await artifact.locator('input[name="confirmSlug"]').fill("e2e-backup-lapsed");
  await artifact.locator('input[name="reason"]').fill("customer asked for erasure");
  await artifact.locator('input[name="override"]').check();
  await artifact.getByRole("button", { name: /queue deletion/i }).click();
  await expect(artifact).toContainText(/Deletion queued/i);
  expect((await findBackupJobs("e2e-backup-lapsed"))[0]).toMatchObject({
    action: "DELETE",
    status: "PENDING",
    ref: "lapsed-restic-1",
    reason: "customer asked for erasure",
    override: true,
  });
});
