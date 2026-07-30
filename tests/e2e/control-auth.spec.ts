import { expect, type Page, test } from "@playwright/test";

// First browser E2E for sofra (DEV-PHASES W1). Proves the RBAC seam end-to-end:
// role-based landing + cross-role denial. Credentials are seeded by
// scripts/seed-e2e.mjs into a throwaway DB; specs read them from env.
//
// The login rate limit is 20/IP/15min (in-memory, lib/actions/auth-actions.ts)
// — this suite logs in a few times total, well under the cap. Selectors are
// name-based so they survive the control plane's cookie-driven locale.
//
// NOTE, corrected 2026-07-30: this used to say `upgrade-insecure-requests` stops
// `/_next/*` from loading over plain http, so the browser only ever exercises the
// JS-less path and "a future assertion that needs client hydration would flake
// here without an obvious cause."
//
// **That is not what happens, and acting on it would have cost a suite.** Chromium
// treats `http://localhost` as a potentially-trustworthy origin (Secure Contexts)
// and does NOT upgrade it, so the bundle loads and the page hydrates normally. The
// O2 specs (tests/e2e/self-serve-signup.spec.ts) depend on that outright — the
// public signup form is a fetch-based client component with no `action` attribute,
// so without JS it would do nothing at all — and 12 of them pass.
//
// What IS true is the smaller claim in next.config.ts: some cross-origin/RSC
// fetches do get upgraded and log `ERR_SSL_PROTOCOL_ERROR`. Harmless, and not the
// same thing as "no JavaScript runs". Don't re-derive the stronger version from
// those console errors.

// Credentials come only from the environment — the same throwaway values
// scripts/seed-e2e.mjs seeds (CI generates them per-run). No literals in source.
function required(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`${name} must be set to run the smoke (see scripts/seed-e2e.mjs + the e2e_smoke CI job)`);
  return v;
}
const admin = { email: required("E2E_ADMIN_EMAIL"), password: required("E2E_ADMIN_PASSWORD") };
const partner = { email: required("E2E_PARTNER_EMAIL"), password: required("E2E_PARTNER_PASSWORD") };

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
