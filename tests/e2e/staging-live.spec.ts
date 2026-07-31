import { expect, test } from "./helpers/fixtures";
import { CANONICAL_SITE_URL } from "@/lib/seo";
import { readFileSync } from "node:fs";

/**
 * The DEPLOYED control plane at staging.sofrapiwas.com.
 *
 * The rest of this suite is already unmocked — real build, real Postgres, a real Mollie
 * first payment on the `test_` key. It is not a weaker test than this one. What it cannot
 * see is everything that only exists once something is deployed:
 *
 *   - the box `.env` actually reaching the container, with the RIGHT values — the staging
 *     database rather than production's, its own AUTH_SECRET, a Mollie key at all
 *   - the founder-run `:migrate-staging` one-off having actually run, so the schema the
 *     app queries exists
 *   - Caddy routing the host at all, and TLS for a name that had never been served
 *   - that what is deployed is a STAGING bake rather than the production image
 *
 * Two of those bit while standing this environment up: a `:staging` image tag whose job
 * could never fire, and a `:migrate-staging` tag that was dead code — both invisible until
 * something tried to pull the artifact.
 *
 * What this suite does NOT prove, so nobody reads more into a green run than is there:
 *   - that the deployed image is CURRENT. A months-old `:staging` bake passes everything
 *     here. There is no version or health endpoint to assert against; adding one is the
 *     fix, not a cleverer assertion.
 *   - that the Mollie key is a `test_` key rather than a `live_` one. `mollieConfigured()`
 *     reports only that SOME key is set and nothing surfaces the prefix — see the billing
 *     test, which is named for what it can actually establish.
 *
 * READ-ONLY BY CONSTRUCTION. It signs in and looks: no account, no payment, no row. There
 * is nothing to restore and no way for a failed run to leave the environment dirty. The
 * mutating flows belong to `e2e-suite.sh`, which owns a throwaway database it can drop —
 * and `playwright.config.ts` now enforces that split, so an `E2E_REMOTE` run cannot reach
 * them however it is invoked.
 */

const BASE = process.env.E2E_BASE_URL ?? "";

/** Hosts, not strings: `https://sofrapiwas.com/` must not slip past a `!==` compare. */
function hostOf(url: string): string {
  try {
    return new URL(url).host.replace(/^www\./, "");
  } catch {
    return "";
  }
}

/**
 * `STAGING_ADMIN='{email: …, password: …}'` from the gitignored `.env`.
 *
 * The quotes are REQUIRED and this is the reason: `scripts/e2e-suite.sh` sources this same
 * file with `set -a && . ./.env`, and bash reads an unquoted `{email: a@b.com, password: x}`
 * as an assignment followed by the command `a@b.com,`. Under the script's `set -euo pipefail`
 * that is a fatal "command not found" and the entire primary E2E suite dies before it starts
 * Postgres — reported as an email address, which names nothing you would think to look at.
 *
 * Parsed with two anchored patterns rather than `split(":")`, because the value carries three
 * colons and a naive split yields an email of `"…, password"`; the API then answers a
 * perfectly honest 401 that reads like a stale credential. Both captures are shape-checked
 * and the whole line must match, so a malformed entry fails LOUDLY here instead of arriving
 * at the login form as a wrong-but-truthy credential and timing out as "staging is down".
 */
function stagingAdmin(): { email: string; password: string } {
  let raw: string;
  try {
    raw = readFileSync(".env", "utf8");
  } catch {
    throw new Error("no .env in the sofra repo — STAGING_ADMIN is required for the deployed run");
  }

  const line = raw.split("\n").find((l) => l.startsWith("STAGING_ADMIN="));
  if (!line) throw new Error("no STAGING_ADMIN in .env — required for the deployed staging run");

  const value = line
    .slice(line.indexOf("=") + 1)
    .trim()
    .replace(/^["']|["']$/g, "");
  const body = value.replace(/^\{/, "").replace(/\}$/, "");
  // Per-value unquoting as well as per-line: `{email: "a@b.com", password: "p"}` is a
  // perfectly reasonable thing to write, and without this the quotes ride along INTO the
  // login form — truthy, shape-valid, and rejected by the API as a wrong password.
  const unquote = (s: string | undefined) => s?.trim().replace(/^["']|["']$/g, "");
  const email = unquote(/email\s*:([^,]*)/.exec(body)?.[1]);
  const password = unquote(/password\s*:([^}]*)$/.exec(body)?.[1]);

  // Shape checks, because every malformed variant above still yields something truthy:
  // a swapped key order gives a password of "p, email: a@b.com", and a stray trailing
  // comment gives "p} # staging box". Both would log in wrong and look like an outage.
  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    throw new Error("STAGING_ADMIN in .env has no valid email — expected {email: …, password: …}");
  }
  if (!password || /[:}]/.test(password)) {
    throw new Error("STAGING_ADMIN in .env has a malformed password — check the {email: …, password: …} shape");
  }
  return { email, password };
}

test.describe("the deployed staging control plane", () => {
  // No skip guard here: `playwright.config.ts` only admits this file when E2E_REMOTE is set,
  // so reaching it at all means a deployed run was asked for. A missing credential is then an
  // ERROR, not a skip — a skipped authed half exits 0 and reports success having verified
  // nothing behind the login, which is where every claim in this file's docstring lives.

  test("serves the marketing site and the control-plane entry points", async ({ page }) => {
    for (const path of ["/en", "/login"]) {
      const res = await page.goto(path, { waitUntil: "domcontentloaded" });
      expect(res?.status(), `${path} should serve`).toBe(200);
    }
    // The signup redirects to the locale-prefixed route; following it must land on a real
    // configurator, not a 404 — this is the funnel's front door.
    await page.goto("/signup", { waitUntil: "domcontentloaded" });
    expect(page.url()).toMatch(/\/[a-z]{2}\/signup/);
    await expect(page.getByRole("button", { name: /sign up|get started|continue/i }).first()).toBeVisible();
  });

  test("staging is not indexable, and says so twice", async ({ page, request }) => {
    // A public twin of the marketing site left crawlable would compete with the real one
    // for exactly the citations the AEO work exists to win — on content that is by
    // definition ahead of what we decided to publish.
    const robots = await request.get(`${BASE}/robots.txt`);
    expect(robots.status()).toBe(200);
    const body = await robots.text();
    expect(body, "staging robots.txt must disallow everything").toMatch(/Disallow:\s*\/\s*$/m);
    expect(body, "staging must not invite AI crawlers the canonical site invites").not.toMatch(/GPTBot/i);

    // And again in a header, for the crawlers that never fetch robots.txt.
    const res = await page.goto("/en", { waitUntil: "domcontentloaded" });
    expect(res?.headers()["x-robots-tag"] ?? "", "X-Robots-Tag").toMatch(/noindex/i);
  });

  test("PRODUCTION is still crawlable (fails here, but the fault is on sofrapiwas.com)", async ({ request }) => {
    // Deliberately asserted from the staging suite: the same commit that flips staging to
    // noindex could flip production, and `robots.ts` decides between them at RUNTIME from the
    // deployment's own base URL. A staging suite that never looks at production reports
    // all-clear either way. The title carries the attribution because a prod incident or a
    // Caddy blip turns this red inside a describe named for staging, and the reflex is to go
    // look at the wrong environment. This wants a scheduled monitor eventually; until one
    // exists, an assertion that runs is worth more than a plan for one that would.
    const res = await request.get(`${CANONICAL_SITE_URL}/robots.txt`);
    expect(res.status()).toBe(200);
    const prod = await res.text();
    expect(prod, "production robots.txt must still allow crawling").toMatch(/^Allow:\s*\//m);
    expect(prod, "production must still invite AI crawlers (AEO)").toMatch(/GPTBot/i);
  });

  // ONE login for all the authed assertions. `lib/auth.ts` allows 10 per email per 15
  // minutes, so a test-per-login suite would throttle itself after five runs — and a 429
  // there returns a null user, which renders as an ordinary "invalid credentials" and reads
  // like a broken password rather than a suite that ate its own budget.
  test.describe("signed in as the staging admin", () => {
    test.describe.configure({ mode: "serial" });

    let page: import("@playwright/test").Page;

    test.beforeAll(async ({ browser }) => {
      // The config's testMatch keeps the MUTATING specs off a deployed host; this keeps
      // THIS spec off production. Without it a mistyped E2E_BASE_URL would drive real logins
      // against the live control plane using the owner's own address, and `lib/auth.ts`
      // counts failures toward 10-per-email-per-15-minutes — a few runs lock them out of
      // production. Checked before the first navigation, not after.
      expect(hostOf(BASE), "refusing to run against the canonical production host").not.toBe(
        hostOf(CANONICAL_SITE_URL),
      );

      const creds = stagingAdmin();
      // The 30s default is the whole-test budget and the hook shares it, so the explicit
      // waitForURL timeout below was unreachable: a cold container after a roll would fail
      // in navigation and read as an outage. Raising patience weakens nothing.
      test.setTimeout(90_000);

      page = await browser.newPage({ baseURL: BASE });
      // Pin the control plane's locale. `lib/control-locale.ts` reads the NEXT_LOCALE cookie,
      // and the two strings asserted below exist in all six message files — under a non-`en`
      // locale the provisioning check fails loudly while the billing check would go QUIET,
      // which is exactly the wrong pair of directions.
      await page.context().addCookies([{ name: "NEXT_LOCALE", value: "en", url: BASE }]);

      await page.goto("/login", { waitUntil: "domcontentloaded" });
      await page.getByLabel(/email/i).fill(creds.email);
      await page.getByLabel(/password/i).fill(creds.password);
      await page.getByRole("button", { name: /sign in|log in/i }).click();
      await page.waitForURL(/\/admin/, { timeout: 60_000 });
    });

    test.afterAll(async () => {
      await page?.close();
    });

    test("the admin dashboard renders — the schema and the box env are real", async () => {
      // Asserted on the page's OWN heading, not `getByRole("heading").first()`. That earlier
      // shape passed on the failure it claimed to catch: `app/global-error.tsx` is the only
      // error boundary in the app and renders `<h1>Something went wrong</h1>`, so an
      // unmigrated table would throw during render, leave the URL on /admin (waitForURL is
      // status-blind), and satisfy a first-heading assertion.
      //
      // Reaching a WORKING /admin also stands in for the DB-separation check this suite
      // otherwise lacks: the account it signs in with was seeded only on staging, so a
      // container wired to production's DATABASE_URL cannot authenticate it at all.
      await expect(page.getByRole("heading", { name: /partner applications|admin|dashboard/i }).first()).toBeVisible();
      await expect(page.getByText(/something went wrong/i), "the admin page must not be an error boundary").toHaveCount(
        0,
      );
    });

    test("a Mollie key is wired into the container", async () => {
      // Named for what it can establish. `lib/mollie.ts#mollieConfigured` returns
      // `Boolean(process.env.MOLLIE_API_KEY)` — absence of this banner means SOME key is set,
      // and nothing on any surface exposes the prefix, so a `live_` key here would pass. That
      // gap is real and belongs in the docstring rather than in an overclaiming test name.
      const res = await page.goto("/admin/billing", { waitUntil: "domcontentloaded" });
      expect(res?.status()).toBe(200);
      // A positive anchor FIRST. `goto` returns the final response after redirects, so a
      // `requireAdmin()` bounce to /login is also a 200 — and a page that never mentions
      // MOLLIE_API_KEY satisfies any absence assertion. Concretely: the container restarts
      // with a regenerated AUTH_SECRET mid-run, the JWT is rejected, and an absence-only
      // check reports the key as correctly configured.
      await expect(page.getByRole("heading", { name: /billing/i }).first()).toBeVisible();
      await expect(
        page.getByText(/MOLLIE_API_KEY is not set/i),
        "a Mollie key should be reaching the staging container",
      ).toHaveCount(0);
    });

    test("provisioning is deliberately DISARMED here", async () => {
      // The most valuable thing this environment gets wrong on purpose. `PROVISION_GITHUB_TOKEN`
      // is left empty in the staging service, so nothing here can open a registry PR or
      // dispatch the provisioning chain against the real deploy repo. Asserted positively,
      // because the failure to catch is someone helpfully "fixing" the missing env var and
      // handing a test environment write access to production infrastructure.
      const res = await page.goto("/admin/provision", { waitUntil: "domcontentloaded" });
      expect(res?.status()).toBe(200);
      await expect(
        page.getByText(/set PROVISION_GITHUB_TOKEN/i),
        "staging must NOT be able to dispatch real provisioning",
      ).toBeVisible();
    });
  });
});
