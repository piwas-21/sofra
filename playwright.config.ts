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
  use: {
    baseURL,
    trace: "retain-on-failure",
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: {
    command: "npm run start",
    url: baseURL,
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
});
