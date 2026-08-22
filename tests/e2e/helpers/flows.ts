// Shared drivers for the E2E suite: filling the public signup, getting an owner
// into their dashboard, and logging in as the seeded admin.
//
// Kept here rather than duplicated per spec so a form change is a one-line fix,
// and so each spec reads as the *flow* it asserts rather than as form-filling.

import { createHash, randomBytes } from "node:crypto";
import { expect, type Page } from "@playwright/test";
import pg from "pg";

/** A per-run namespace, so a rerun never collides with its own leftovers.
 *  The slug grammar is `[a-z0-9][a-z0-9-]{1,30}`, so keep it short and lowercase. */
export const RUN_ID = randomBytes(3).toString("hex");

export const uniq = {
  slug: (label: string) => `e2e-${label}-${RUN_ID}`,
  email: (label: string) => `e2e-${label}-${RUN_ID}@example.test`,
};

export function required(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`${name} must be set to run the E2E suite (see scripts/e2e-suite.sh)`);
  return v;
}

/**
 * Fill and submit the public signup configurator.
 *
 * `modules` are the à-la-carte checkboxes; `core` is never passed because it
 * rides a hidden input and is always submitted (its checkbox reading unchecked
 * is correct, not a dropped value).
 */
export async function submitSignup(
  page: Page,
  opts: {
    slug: string;
    email: string;
    restaurantName?: string;
    contactName?: string;
    modules?: string[];
    city?: string;
    /** Which language the visitor fills the form in. The form carries it, the lead
     *  stores it, and since G9 so does the ACCOUNT — which is what decides the
     *  language of every mail that follows. */
    locale?: string;
  },
): Promise<void> {
  await page.goto(`/${opts.locale ?? "en"}/signup`, { waitUntil: "domcontentloaded" });
  await page.fill('input[name="restaurantName"]', opts.restaurantName ?? "E2E Restaurant");
  await page.fill('input[name="contactName"]', opts.contactName ?? "E2E Owner");
  await page.fill('input[name="email"]', opts.email);
  if (opts.city) await page.fill('input[name="city"]', opts.city);
  await page.fill('input[name="desiredSlug"]', opts.slug);
  for (const m of opts.modules ?? ["kitchen-board", "cashier"]) {
    await page.check(`input[name="modules"][type="checkbox"][value="${m}"]`);
  }
  await page.click('button[type="submit"]');
}

/**
 * The signup succeeded and an account exists.
 *
 * This suite runs with `RESEND_API_KEY=""` on purpose (scripts/e2e-suite.sh, and
 * ci.yml does the same), so `sendEmail` never sends and the route answers
 * `emailed:false` on EVERY signup here. Before G5 the form said "check your
 * email to set your password" anyway — these specs asserted that copy, which
 * means the suite had been reproducing the gap all along and passing on it. The
 * honest copy is what this environment must produce, so asserting it is the
 * regression test: restore the old unconditional message and every one of these
 * specs fails.
 */
export async function expectAccountCreated(
  page: Page,
  opts: { locale?: string } = {},
): Promise<void> {
  // The same sentence, in the language the visitor filled the form in. Matched per
  // locale rather than loosened to a shared substring: a signup submitted on
  // `/fr/signup` that answered in English would be the exact G9 defect this suite
  // is here to catch, and a laxer matcher would pass through it.
  const SUCCESS_NO_EMAIL: Record<string, RegExp> = {
    en: /our welcome email didn't get through/i,
    fr: /notre e-mail de bienvenue n'est pas parti/i,
  };
  const pattern = SUCCESS_NO_EMAIL[opts.locale ?? "en"];
  if (!pattern) throw new Error(`no success-copy matcher for locale ${opts.locale}`);
  await expect(page.getByText(pattern)).toBeVisible();
}

/**
 * Mint a usable set-password link for a freshly created account.
 *
 * The raw token only ever exists inside the welcome email, so there is nothing to
 * read back: the DB stores `sha256(raw)` (lib/tokens.ts). This inserts a token row
 * with a hash computed the same way, which is safe from drift **because the
 * assertion is that the app accepts the link** — if the hashing ever diverged,
 * `/invite/<raw>` would 404 and the spec would fail loudly rather than pass on a
 * stale assumption.
 */
export async function mintInviteLink(userId: string): Promise<string> {
  const raw = randomBytes(32).toString("base64url");
  const tokenHash = createHash("sha256").update(raw).digest("hex");
  const client = new pg.Client({ connectionString: required("DATABASE_URL") });
  await client.connect();
  try {
    await client.query(
      `INSERT INTO "InviteToken" (id, "userId", "tokenHash", purpose, "expiresAt", "createdAt")
       VALUES (gen_random_uuid()::text, $1, $2, 'invite', now() + interval '24 hours', now())`,
      [userId, tokenHash],
    );
  } finally {
    await client.end();
  }
  return `/invite/${raw}`;
}

/** Set the first password through the real invite page, then sign in. */
export async function activateAndLogin(
  page: Page,
  opts: { inviteLink: string; email: string; password: string },
): Promise<void> {
  await page.goto(opts.inviteLink, { waitUntil: "domcontentloaded" });
  await page.fill('input[name="password"]', opts.password);
  await page.fill('input[name="confirm"]', opts.password);
  await page.click('button[type="submit"]');
  await page.waitForURL(/\/login/);
  await login(page, opts);
  await page.waitForURL(/\/dashboard/);
}

export async function login(
  page: Page,
  creds: { email: string; password: string },
): Promise<void> {
  await page.goto("/login");
  await page.fill('input[name="email"]', creds.email);
  await page.fill('input[name="password"]', creds.password);
  await page.click('button[type="submit"]');
}

/** Log in as the ADMIN seeded by scripts/seed-e2e.mjs. */
export async function loginAsAdmin(page: Page): Promise<void> {
  await login(page, {
    email: required("E2E_ADMIN_EMAIL"),
    password: required("E2E_ADMIN_PASSWORD"),
  });
  await page.waitForURL(/\/admin/);
}

/**
 * Ask the admin provisioning form to open a registry PR for a slug, and return
 * whatever the page says back.
 *
 * The suite only ever uses this to observe the O2 payment gate, which refuses
 * *before* the GitHub round-trip — so `PROVISION_GITHUB_TOKEN` is a placeholder
 * and no real PR can be opened. When the gate lets a request through, the GitHub
 * call fails on that placeholder, and that failure is the proof it passed.
 */
export async function attemptProvision(page: Page, slug: string): Promise<string> {
  await page.goto("/admin/provision", { waitUntil: "domcontentloaded" });
  await page.fill('input[name="slug"]', slug);
  await page.fill('input[name="name"]', "E2E Restaurant");
  await page.fill('input[name="adminEmail"]', "e2e-provision@example.test");
  await page.fill('input[name="city"]', "Geneva");
  await page.check('input[name="modules"][type="checkbox"][value="cashier"]');
  const submit = page.getByRole("button", { name: /open registry pr|opening/i });
  await submit.click();

  // Two waits, because neither alone is sound.
  //
  // Not page text: the static form copy already contains the words "registry PR",
  // so a body-text match returns instantly and reads the mid-submit "Opening…" as
  // the result.
  //
  // Not the button alone either: `ProvisionForm` derives `disabled` from
  // `useActionState`'s `pending`, which never becomes true without hydration — so
  // on a JS-less render `toBeEnabled` passes on the first poll, racing the form
  // navigation. (Hydration does work here — see tests/e2e/control-auth.spec.ts —
  // but an assertion that depends on that silently stops testing anything if it
  // ever stops being true.)
  //
  // So: button settled AND a non-empty outcome element present. `<ActionError />`
  // renders role="alert"; a success renders the PR link. The `hasText` filter
  // excludes an empty alert, which is what made an earlier version return "".
  await expect(submit).toBeEnabled({ timeout: 30_000 });
  const outcome = page
    .locator('main [role="alert"], main a[href*="github.com"]')
    .filter({ hasText: /\S/ })
    .first();
  await expect(outcome).toBeVisible({ timeout: 30_000 });
  return await outcome.innerText();
}
