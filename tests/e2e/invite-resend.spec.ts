import { expect, test } from "./helpers/fixtures";
import { arrangeInvitedUser, countInviteTokens, findAuditEntries } from "./helpers/db";

// "Resend my invite" (G12) — the recovery path for the one state the funnel had no
// answer for: an owner whose account exists, who has never had a password, and
// whose 24h set-password link has expired. Until this shipped, the only ways out
// were a founder running /admin/onboard by hand or the owner guessing that
// "Forgot password" applies to a password they never had.
//
// TWO PROPERTIES, and neither is visible in a unit test. The form must answer the
// SAME sentence to every address (an oracle for "which restaurants are customers"
// is a competitor's research budget), and a re-send must retire the older unused
// invites so the mail in the owner's hand is the one that works.
//
// `resend-invite` is 5 per IP per 15 minutes; the fixture gives each test its own
// apparent client (helpers/fixtures.ts), and the one test that submits twice stays
// well inside a single bucket.

const KNOWN = "e2e-resend-invited@example.com";
const UNKNOWN = "e2e-resend-nobody@example.com";

async function submit(page: import("@playwright/test").Page, email: string) {
  await page.fill('input[name="email"]', email);
  await page.click('button[type="submit"]');
}

test("an expired invite link offers a new one instead of a dead end", async ({ page }) => {
  // The page a real owner lands on when their link has aged out. It used to say
  // "reply to your approval email" — a support ticket, in a funnel whose whole
  // point is that nobody has to be watching.
  await page.goto("/invite/not-a-real-token-at-all", { waitUntil: "domcontentloaded" });
  await expect(page.getByText(/invalid or has expired/i)).toBeVisible();
  await expect(page.locator('input[name="email"]')).toBeVisible();
});

test("a re-send answers the same to an unknown address as to a real one", async ({ page }) => {
  const userId = await arrangeInvitedUser(KNOWN);

  await page.goto("/invite/resend", { waitUntil: "domcontentloaded" });
  await submit(page, UNKNOWN);
  const unknownAnswer = await page.getByRole("status").textContent();
  expect(unknownAnswer).toMatch(/if that address has an account/i);

  await page.goto("/invite/resend", { waitUntil: "domcontentloaded" });
  await submit(page, KNOWN);
  const knownAnswer = await page.getByRole("status").textContent();

  // THE ANTI-ENUMERATION ASSERTION: byte-identical, not merely both cheerful.
  expect(knownAnswer).toBe(unknownAnswer);

  // …while what actually LEFT differs. Exactly one live invite: the fresh one,
  // with the stale token from the arrangement retired rather than left alongside
  // it, so the link the owner is reading is the link that opens the account.
  expect(await countInviteTokens(userId)).toBe(1);

  // And the verdict is durable, in the shape /admin's delivery badges already read
  // (G16): written either way, carrying `emailed`.
  const entries = await findAuditEntries("invite.resend.requested", userId);
  expect(entries).toHaveLength(1);
  expect(entries[0].meta).toMatchObject({ kind: "invite" });
  expect(entries[0].meta).toHaveProperty("emailed");
});
