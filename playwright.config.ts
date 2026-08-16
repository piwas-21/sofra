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

// E2E_REMOTE points the run at a DEPLOYED environment, and the split is enforced BOTH
// ways: remote runs the staging spec and nothing else, local runs everything else and never
// the staging spec.
//
// The remote direction is a safety interlock. Every other spec here MUTATES —
// self-serve-signup writes User/Plan/SignupRequest rows, billing-mollie creates real
// payments, owner-dashboard repoints billing records — and they reach their target through
// relative `page.goto`, so `E2E_REMOTE=1 E2E_BASE_URL=https://staging… npx playwright test`
// (the obvious generalisation of the npm script) would run all of them against the
// long-lived shared environment, which has no throwaway database to drop. Their own
// assertions would then fail against the wrong DATABASE_URL — but the writes would already
// have landed.
//
// The local direction is not symmetry for its own sake: without it the staging spec joins
// `test:e2e:full`, where it asserts deployment facts against `localhost` — robots is
// allow-all there by design, and the staging admin account does not exist — and fails for
// reasons that say nothing about the change under test. Enforcing it here rather than with a
// `test.skip` inside the spec is what lets a missing credential be a hard ERROR when the
// spec does run: a skipped authed half still exits 0, and reports success having verified
// nothing behind the login.
const REMOTE = Boolean(process.env.E2E_REMOTE);
const STAGING_SPEC = /staging-live\.spec\.ts$/;

export default defineConfig({
  testDir: "tests/e2e",
  ...(REMOTE ? { testMatch: STAGING_SPEC } : { testIgnore: STAGING_SPEC }),
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
  // Skip the local server when the run targets a DEPLOYED environment
  // (E2E_REMOTE=1 with E2E_BASE_URL=https://staging.sofrapiwas.com). Without this,
  // pointing baseURL at staging still runs `npm run start` and waits two minutes on a
  // port nothing will answer. Mirrors the frontend repo's config.
  // `npm run start:standalone`, NOT `next start`: next.config.ts sets
  // output: "standalone", which `next start` refuses to serve as-built (it
  // warns and falls back to the ordinary server). The suite was therefore
  // exercising a server shape that never ships. This runs
  // .next/standalone/server.js — the same entrypoint as the Docker image —
  // after copying .next/static and public/, which standalone does not copy.
  webServer: REMOTE
    ? undefined
    : {
        command: "npm run start:standalone",
        url: baseURL,
        reuseExistingServer: !process.env.CI,
        timeout: 120_000,
      },
});
