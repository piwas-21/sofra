import { expect, type Page, test } from "@playwright/test";

// First browser E2E for sofra (DEV-PHASES W1). Proves the RBAC seam end-to-end:
// role-based landing + cross-role denial. Credentials are seeded by
// scripts/seed-e2e.mjs into a throwaway DB; specs read them from env.
//
// The login rate limit is 10/email/15min (in-memory) — this suite logs in
// each account at most once, well under the cap. Selectors are name-based so
// they survive the control plane's cookie-driven locale.

const admin = {
  email: process.env.E2E_ADMIN_EMAIL ?? "e2e-admin@example.com",
  password: process.env.E2E_ADMIN_PASSWORD ?? "changeme-admin-123",
};
const partner = {
  email: process.env.E2E_PARTNER_EMAIL ?? "e2e-partner@example.com",
  password: process.env.E2E_PARTNER_PASSWORD ?? "changeme-partner-123",
};

async function login(page: Page, creds: { email: string; password: string }) {
  await page.goto("/login");
  await page.fill('input[name="email"]', creds.email);
  await page.fill('input[name="password"]', creds.password);
  await page.click('button[type="submit"]');
}

test("admin logs in and lands on the admin console", async ({ page }) => {
  await login(page, admin);
  // loginAction redirects to /dashboard; requirePartner bounces an ADMIN to /admin.
  await page.waitForURL("**/admin");
  await expect(page).toHaveURL(/\/admin$/);
});

test("partner logs in and lands on their dashboard", async ({ page }) => {
  await login(page, partner);
  await page.waitForURL("**/dashboard");
  await expect(page.getByRole("heading", { name: /your clients/i })).toBeVisible();
});

test("partner is denied the admin console", async ({ page }) => {
  await login(page, partner);
  await page.waitForURL("**/dashboard");
  // requireAdmin() redirects a PARTNER back to /dashboard.
  await page.goto("/admin");
  await expect(page).toHaveURL(/\/dashboard$/);
});
