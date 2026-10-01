import pg from "pg";
import { randomBytes } from "node:crypto";
import { test, expect } from "./helpers/fixtures";
import { loginAsAdmin } from "./helpers/flows";

const slug = "e2e-printer";
test("printer keys are masked, audited, renewed only after verification and scoped to their box", async ({ page, request }) => {
  const oldKey = randomBytes(32).toString("hex");
  const agent = process.env.PRINTER_AGENT_SECRET_STAGING;
  expect(agent, "local test agent credential must be configured").toBeTruthy();
  const report = (key: string, verified = true, box = "staging", tenantSlug = slug) => request.post("/api/printers/sync", {
    headers: { authorization: `Bearer ${agent}` },
    data: { box, credentials: [{ tenantSlug, key, verified, renewable: true }] },
  });
  expect((await request.post("/api/printers/sync", { data: {} })).status()).toBe(401);
  expect((await report(oldKey, true, "prod")).status()).toBe(403);
  expect((await report(oldKey, true, "staging", "e2e-retired")).status()).toBe(403);
  expect((await report(oldKey, true, "staging", "e2e-occupied")).status()).toBe(403);
  expect((await report(oldKey)).status()).toBe(200);
  expect((await report(oldKey, true, "staging", "e2e-printer-other")).status()).toBe(200);
  await page.goto("/admin/printers");
  await expect(page).toHaveURL(/\/login/);
  await loginAsAdmin(page);
  await page.goto("/admin/printers");
  const other = page.locator("li").filter({ hasText: "E2E Other Printer Restaurant" });
  await other.getByText("Renew token", { exact: true }).click();
  await other.getByLabel("Type e2e-printer-other to confirm").fill("e2e-printer-other");
  await other.getByRole("button", { name: "Request new token" }).click();
  await expect(other.getByRole("status")).toContainText("Renewal pending");
  // This agent's report covers only one tenant; unrelated queued jobs stay private.
  expect((await (await report(oldKey)).json()).jobs).toHaveLength(0);
  const response = await page.goto("/admin/printers");
  expect(await response!.text()).not.toContain(oldKey);
  const card = page.locator("li").filter({ hasText: "E2E Printer Restaurant" });
  await expect(card.getByText("Ready to share", { exact: true })).toBeVisible();
  await card.getByRole("button", { name: "Reveal token" }).click();
  await expect(card.getByText(oldKey, { exact: true })).toBeVisible();
  await card.getByRole("button", { name: "Hide token" }).click();
  await expect(card.getByText(oldKey, { exact: true })).toHaveCount(0);
  await card.getByText("Renew token", { exact: true }).click();
  await card.getByLabel(`Type ${slug} to confirm`).fill("other");
  await card.getByRole("button", { name: "Request new token" }).click();
  await expect(card.getByRole("alert")).toContainText("must match exactly");
  await card.getByLabel(`Type ${slug} to confirm`).fill(slug);
  await card.getByRole("button", { name: "Request new token" }).click();
  await expect(card.getByRole("status")).toContainText("Renewal pending");
  await expect(card.getByRole("button", { name: "Reveal token" })).toBeDisabled();
  const pending = await report(oldKey);
  const jobs = (await pending.json()).jobs as { tenantSlug: string; key: string }[];
  expect(jobs).toHaveLength(1);
  const newKey = jobs[0].key;
  expect(newKey).not.toBe(oldKey);
  // A failed installation MUST NOT acknowledge the replacement.
  expect((await (await report(newKey, false)).json()).jobs).toHaveLength(1);
  expect((await (await report(newKey)).json()).jobs).toHaveLength(0);
  await card.getByRole("button", { name: "Refresh status" }).click();
  await expect(card.getByRole("status")).toHaveText("Ready to share");
  await card.getByRole("button", { name: "Reveal token" }).click();
  await expect(card.getByText(newKey, { exact: true })).toBeVisible();
  await expect(card.getByText(oldKey, { exact: true })).toHaveCount(0);
  const db = new pg.Client({ connectionString: process.env.DATABASE_URL });
  await db.connect();
  try {
    const stored = await db.query('SELECT "keyCipher", "pendingCipher" FROM "PrinterCredential" WHERE "tenantSlug"=$1', [slug]);
    expect(stored.rows[0].keyCipher).not.toContain(newKey);
    expect(stored.rows[0].pendingCipher).toBeNull();
    const audit = await db.query('SELECT action, meta FROM "AuditLog" WHERE "entityId"=$1 AND action LIKE $2', [slug, "printer.key.%"]);
    expect(audit.rows.map((r) => r.action)).toEqual(expect.arrayContaining(["printer.key.revealed", "printer.key.requested", "printer.key.applied"]));
    expect(JSON.stringify(audit.rows)).not.toContain(newKey);
    expect(JSON.stringify(audit.rows)).not.toContain(oldKey);
  } finally { await db.end(); }
  // Replay the actual reveal server action without a session: route UI alone is not a guard.
  const revealRequest = page.waitForRequest((r) => r.method() === "POST" && !!r.headers()["next-action"]);
  await card.getByRole("button", { name: "Hide token" }).click();
  await card.getByRole("button", { name: "Reveal token" }).click();
  const actionRequest = await revealRequest;
  const denied = await request.post("/admin/printers", {
    headers: { "next-action": actionRequest.headers()["next-action"], "content-type": actionRequest.headers()["content-type"] },
    data: actionRequest.postData() ?? "",
  });
  expect(await denied.text()).not.toContain(newKey);
});
