// Per-test client identity, so the suite doesn't rate-limit itself.
//
// The public intake allows **5 POSTs per IP per 15 minutes** (`guardIntake`), and
// the login path 20 — deliberately tight, and correct. A suite that exercises the
// signup a dozen times from one machine trips those limits and then fails with
// the generic "something went wrong" copy, which looks exactly like a real
// product bug and sends you debugging the wrong thing.
//
// The fix is to give each test its own apparent client rather than to loosen the
// limit: `clientIp()` reads the LAST hop of `x-forwarded-for` (lib/rate-limit.ts),
// which is what Caddy sets in production, so a per-test header is the same shape
// the app already sees live. Nothing about the production guard changes.
//
// Addresses come from 198.18.0.0/15 — reserved for benchmarking (RFC 2544), so
// they can never collide with a real client's address if this ever ran against a
// shared environment.
//
// **This fixes the IP dimension only.** `lib/auth.ts` also limits
// `login:email:<email>` at 10 per 15 minutes, and that bucket is keyed before the
// password check, so failures count too. No header can isolate it. The shared
// `E2E_ADMIN_EMAIL` currently spends 4 of those 10 per run (doubling under CI's
// `retries: 1`), which has headroom — but if the suite grows more admin logins,
// reuse one session via Playwright `storageState` rather than logging in again.

import { test as base } from "@playwright/test";

let seq = 0;

/**
 * A unique address per test, in the RFC 2544 benchmark range.
 *
 * The worker index has to be in it. Playwright runs specs across several worker
 * PROCESSES, so a module-level counter restarts at zero in each one and two
 * workers hand out the same address — which silently reunites them in the same
 * rate-limit bucket and produces exactly the intermittent failure the header was
 * added to prevent. `parallelIndex` is unique across concurrent workers, so
 * (worker, counter) is collision-free.
 */
function nextClientIp(parallelIndex: number): string {
  seq += 1;
  return `198.18.${parallelIndex % 256}.${(seq % 254) + 1}`;
}

/**
 * The same per-test identity, for `page.request` calls.
 *
 * `page.setExtraHTTPHeaders` below covers requests the BROWSER makes; it does
 * NOT reach `page.request`, Playwright's API client. Measured, not assumed: the
 * contact-intake spec's three tests all landed in ONE rate-limit bucket
 * (`clientIp()` falls back to the literal "unknown" with no `x-forwarded-for`),
 * so the second and third tests were refused 429 by the first test's own calls.
 *
 * Call it ONCE per test and reuse the result across that test's requests — the
 * point is a bucket per test, not per request.
 */
export function apiClientHeaders(): Record<string, string> {
  return { "x-forwarded-for": nextClientIp(base.info().parallelIndex) };
}

// The second fixture argument is positional, so it is NOT named `use`: eslint's
// react-hooks/rules-of-hooks reads a call to `use(...)` inside a function called
// `page` as a misplaced React hook and errors. Renaming is cheaper than an
// eslint-disable, and clearer than either.
export const test = base.extend({
  page: async ({ page }, runTest, testInfo) => {
    await page.setExtraHTTPHeaders({
      "x-forwarded-for": nextClientIp(testInfo.parallelIndex),
    });
    await runTest(page);
  },
});

export { expect } from "@playwright/test";
