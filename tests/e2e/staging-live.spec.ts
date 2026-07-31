import { expect, test } from "./helpers/fixtures";
import { readFileSync } from "node:fs";

/**
 * The DEPLOYED control plane at staging.sofrapiwas.com.
 *
 * The rest of this suite is already unmocked — real build, real Postgres, a real Mollie
 * first payment on the `test_` key. It is not a weaker test than this one. What it cannot
 * see is everything that only exists once something is deployed:
 *
 *   - the box `.env` actually reaching the container, and the RIGHT values reaching it —
 *     the staging database rather than production's, the `test_` Mollie key rather than
 *     the `live_` one, its own AUTH_SECRET
 *   - the founder-run `:migrate-staging` one-off having actually run, so the schema the
 *     app queries exists
 *   - Caddy routing the host at all, and TLS for a name that had never been served
 *   - the image that was PUBLISHED, not the one `next build` produces locally
 *
 * Every one of those has bitten this workspace in the last day. Two of them bit while
 * standing this environment up: a `:staging` image tag whose job could never fire, and a
 * `:migrate-staging` tag that was dead code — both invisible until something tried to
 * pull the artifact.
 *
 * READ-ONLY BY CONSTRUCTION. This suite signs in and looks. It creates no account, starts
 * no payment and writes no row, so there is nothing to restore and no way for a failed run
 * to leave the environment dirty. Mutating flows belong in `e2e-suite.sh`, which owns a
 * throwaway database it can drop — that is the right place for them, not a long-lived
 * shared environment.
 *
 * Gated on `E2E_REMOTE`, so it never runs against the local `next start` the rest of the
 * suite uses, where every assertion below would be either vacuous or wrong.
 */

const REMOTE = Boolean(process.env.E2E_REMOTE);
const BASE = process.env.E2E_BASE_URL ?? "";
const CANONICAL = "https://sofrapiwas.com";

/** `STAGING_ADMIN={email: …, password: …}` from .env — same shape the frontend repo uses. */
function stagingAdmin(): { email: string; password: string } | null {
  let raw: string;
  try {
    raw = readFileSync(".env", "utf8");
  } catch {
    return null;
  }
  const line = raw.split("\n").find((l) => l.startsWith("STAGING_ADMIN="));
  if (!line) return null;
  // Parsed with two unambiguous patterns rather than split(":") — the value is an object
  // literal and carries three colons, so a naive split yields an email of "…, password"
  // and the API answers a perfectly honest 401 that reads like a stale credential.
  const body = line.slice(line.indexOf("=") + 1).trim().replace(/^\{/, "").replace(/\}$/, "");
  const email = /email\s*:([^,]*)/.exec(body)?.[1]?.trim();
  const password = /password\s*:(.*)$/.exec(body)?.[1]?.trim();
  return email && password ? { email, password } : null;
}

test.describe("the deployed staging control plane", () => {
  test.skip(!REMOTE, "deployed-host only — run `npm run test:e2e:staging`");

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

  test("is not indexable, and says so twice", async ({ page, request }) => {
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

  test("is a SEPARATE deployment from production", async ({ request }) => {
    // The check that would catch the worst possible misconfiguration: staging serving, or
    // being served by, production. If `SOFRA_STAGING_DOMAIN` were ever pointed at the prod
    // container, or the prod image baked with the staging URL, everything above would still
    // pass and this would not.
    expect(BASE, "this suite must not be pointed at the canonical site").not.toBe(CANONICAL);

    const canonicalRobots = await request.get(`${CANONICAL}/robots.txt`);
    expect(canonicalRobots.status()).toBe(200);
    const prod = await canonicalRobots.text();
    // Production is still the crawlable one. Asserted from here because the same commit
    // that could break staging's robots could break production's, and a staging suite that
    // never looks at production would report all-clear either way.
    expect(prod, "production robots.txt must still allow crawling").toMatch(/Allow:\s*\//);
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
      const creds = stagingAdmin();
      test.skip(!creds, "no STAGING_ADMIN in .env for the deployed staging control plane");

      page = await browser.newPage({ baseURL: BASE });
      await page.goto("/login", { waitUntil: "domcontentloaded" });
      await page.getByLabel(/email/i).fill(creds!.email);
      await page.getByLabel(/password/i).fill(creds!.password);
      await page.getByRole("button", { name: /sign in|log in/i }).click();
      await page.waitForURL(/\/admin/, { timeout: 30_000 });
    });

    test.afterAll(async () => {
      await page?.close();
    });

    test("reaching /admin at all proves the schema and the box env are real", async () => {
      // Getting here means `beforeAll` completed, which is the assertion: the session was
      // minted against the STAGING database using the STAGING AuthSecret. That is only
      // possible if the box env reached the container and the `:migrate-staging` one-off
      // actually ran — a missing User table or a wrong DATABASE_URL fails right here rather
      // than in a container log nobody reads.
      await expect(page.getByRole("heading").first()).toBeVisible();
    });

    test("the Mollie TEST key is wired in — billing is not disabled", async () => {
      const res = await page.goto("/admin/billing", { waitUntil: "domcontentloaded" });
      expect(res?.status(), "/admin/billing should render for an admin").toBe(200);
      // Matched against the message the page ACTUALLY renders when the key is absent
      // (`control.admin.billing.mollieMissing`), not a paraphrase. An earlier draft of this
      // asserted `/not configured/i`, which that sentence does not contain — so it could
      // never fail, and would have reported a totally unconfigured environment as green.
      await expect(
        page.getByText(/MOLLIE_API_KEY is not set/i),
        "MOLLIE_API_KEY_TEST should be reaching the staging container",
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
