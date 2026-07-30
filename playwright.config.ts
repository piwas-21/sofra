// Playwright smoke (DEV-PHASES-PLAN W1): first browser E2E — login→admin,
// login→partner, partner blocked from /admin. Deliberately tiny: the login
// rate limit is 20/IP/15min in-memory, so the suite keeps total logins low.
//
// The webServer runs the production build (`next build` first — WITHOUT
// DATABASE_URL, repo rule) and inherits this process's env, so the caller
// provides: DATABASE_URL (migrated + seeded via scripts/seed-e2e.mjs),
// AUTH_SECRET, and the E2E_* credentials the specs read.
import { defineConfig, devices } from "@playwright/test";

const baseURL = process.env.E2E_BASE_URL ?? "http://localhost:3000";

export default defineConfig({
  testDir: "tests/e2e",
  timeout: 30_000,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? "line" : "list",
  // ONE worker, deliberately. Every spec shares a single Next server, a single
  // Postgres and a single in-memory rate limiter, and the billing spec makes real
  // Mollie round-trips. Run in parallel and those compete: a signup or a login
  // re-render behind a live payment can exceed a short assertion budget, and it
  // surfaces as an intermittent "element not found" in an unrelated test — which
  // reads exactly like a product bug. Observed on this suite: the INVITED-owner
  // login check failed only when the billing spec ran alongside it, and passed 3/3
  // alone. The whole suite is well under a minute serially; the parallelism was
  // never worth the class of failure it bought.
  workers: 1,
  use: {
    baseURL,
    trace: "retain-on-failure",
    // 5s is tight for a suite that talks to a real payment provider and a real
    // database. Raising the patience weakens nothing — a correct app still
    // resolves in milliseconds; only a slow one gets the benefit of the doubt.
    actionTimeout: 15_000,
  },
  expect: { timeout: 15_000 },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: {
    command: "npm run start",
    url: baseURL,
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
});
