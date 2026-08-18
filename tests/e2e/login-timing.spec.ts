import { randomUUID } from "node:crypto";
import { expect, test, type APIRequestContext } from "@playwright/test";
import { arrangeUserWithPassword } from "./helpers/db";

// #145 — the login must cost the SAME whether the account exists or not.
//
// lib/auth.ts compares against a per-process dummy hash when the user is absent or not
// ACTIVE, so the failure path burns exactly one bcrypt compare either way. Nothing in CI
// checked that: mutating the line to `user?.passwordHash ?? ""` turns the endpoint into a
// perfect enumeration oracle (measured during #144's review: 0.007s for an unknown address
// vs 0.272s for a known one) and still passes all 471 unit tests and `npm run lint`
// catches it only incidentally, because `dummyHash` happens to become an unused binding.
//
// This is a TIMING test, so it is written to fail for exactly one reason:
//   * the two sides are INTERLEAVED, so a machine that slows down mid-run slows both;
//   * MEDIANS, not means, so one descheduled probe cannot carry the verdict;
//   * the bar is a RATIO with a wide tolerance — a real oracle is a 30-40x gap, and no
//     amount of CI noise turns a one-bcrypt path into half of another one-bcrypt path;
//   * an absolute FLOOR on both sides, because the cheapest way to accidentally make the
//     two equal is to make both fast — a rate-limited or short-circuited login answers in
//     single-digit milliseconds and would otherwise "prove" the property while measuring
//     nothing.
//
// Both rate-limit dimensions are given room, because a rate-limited login returns BEFORE
// the compare and would be timed as a fast one. `lib/auth.ts` allows 20 per IP and 10 per
// address per 15 minutes from an in-memory map the whole suite shares, and counts failures:
// hence a distinct X-Forwarded-For per probe (the last hop is what the limiter buckets on,
// as Caddy sets it in production), a fresh unknown address every time, and a known user
// seeded per run instead of the shared admin — whose budget the other specs already spend.

const PROBES = 5;
const WARMUPS = 2;

// A real oracle is ~40x. Half is far below anything noise produces between two calls that
// each do one bcrypt, and far above the gap a correct implementation can show.
const MIN_RATIO = 0.5;

// One bcrypt round at cost 12 is ~250ms on a laptop and slower on a shared runner. 40ms is
// an order of magnitude under that and an order of magnitude over the ~5ms no-hash path.
const MIN_MEDIAN_MS = 40;

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
}

/** One credentials POST, timed. Returns the wall-clock milliseconds it took. */
async function timeLoginAttempt(request: APIRequestContext, email: string, probe: number): Promise<number> {
  // Auth.js rejects a credentials POST without a matching csrf token + cookie, and the
  // token fetch must NOT be inside the measurement.
  const csrf = await request.get("/api/auth/csrf");
  const { csrfToken } = (await csrf.json()) as { csrfToken: string };

  const started = Date.now();
  const response = await request.post("/api/auth/callback/credentials", {
    // Caddy appends the real client as the LAST hop and lib/rate-limit.ts reads the
    // rightmost token, so this is the address the limiter buckets on.
    headers: { "x-forwarded-for": `203.0.113.${probe % 256}` },
    form: { csrfToken, email, password: "not-the-password-either-way" },
    // Auth.js answers a failed credentials login with a redirect to /login?error=…;
    // following it would add a page render to the measurement.
    maxRedirects: 0,
  });
  const elapsed = Date.now() - started;

  // Both sides must actually reach the provider. A 4xx here (missing csrf, wrong route)
  // would otherwise be timed happily and compared against another 4xx.
  expect(response.status(), "the credentials callback should answer with a redirect").toBeGreaterThanOrEqual(300);
  expect(response.status()).toBeLessThan(400);

  return elapsed;
}

test("an unknown address costs the same as a known one (no user enumeration)", async ({ request }) => {
  // Unique per run so a Playwright RETRY starts on a fresh rate-limit bucket rather than
  // measuring the limiter's early return and calling the two sides equal at 5ms each.
  const knownEmail = `e2e-timing-${randomUUID()}@example.test`;
  await arrangeUserWithPassword(knownEmail, `pw-${randomUUID()}`);

  // A fresh address per probe: the limiter also buckets per email, and a repeated unknown
  // address would be refused before it ever reached the compare.
  const unknown = (probe: number) => `nobody-${Date.now()}-${probe}@example.test`;

  // Warm-ups are discarded: the first request into a freshly started server pays for lazy
  // route compilation and a cold Prisma connection, which is not what this measures.
  for (let i = 0; i < WARMUPS; i += 1) {
    await timeLoginAttempt(request, unknown(i), i);
    await timeLoginAttempt(request, knownEmail, i);
  }

  const unknownTimings: number[] = [];
  const knownTimings: number[] = [];

  for (let i = 0; i < PROBES; i += 1) {
    // Interleaved on purpose — a machine that gets busy halfway through slows both sides.
    unknownTimings.push(await timeLoginAttempt(request, unknown(WARMUPS + i), WARMUPS + i));
    knownTimings.push(await timeLoginAttempt(request, knownEmail, WARMUPS + i));
  }

  const unknownMedian = median(unknownTimings);
  const knownMedian = median(knownTimings);
  const detail = `unknown=${unknownTimings.join()} (median ${unknownMedian}ms), known=${knownTimings.join()} (median ${knownMedian}ms)`;

  // The floor first: if both sides are fast, the ratio below is satisfied by two paths that
  // never hashed anything, and the test would pass while proving the opposite.
  expect(knownMedian, `a known-user login should cost a bcrypt compare — ${detail}`).toBeGreaterThan(MIN_MEDIAN_MS);
  expect(unknownMedian, `an unknown-user login should cost a bcrypt compare — ${detail}`).toBeGreaterThan(MIN_MEDIAN_MS);

  expect(
    unknownMedian / knownMedian,
    `an unknown address must not answer measurably faster than a known one — ${detail}`,
  ).toBeGreaterThan(MIN_RATIO);
});
