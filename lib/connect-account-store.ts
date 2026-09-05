// Where a MINTED Stripe connected account lives between the Stripe call and the
// registry PR that records it (ADR-011 amendment, slice E1).
//
// The gap this closes: minting is a live, billable side effect at Stripe, and
// `stripe_account:` only becomes durable when a human merges the registry PR
// that carries it. Until this module there was no Prisma column anywhere holding
// an `acct_` — the registry YAML was the only tenant -> account map — so a crash
// in that window lost a real account with nothing naming it. The write here
// happens IMMEDIATELY after the mint and BEFORE the PR is composed.
//
// Two guards, layered, because neither is enough alone:
//
//  1. The Stripe `Idempotency-Key`, derived from the slug. MEASURED 2026-09-05
//     on the test platform (acct_1TpwTNCAHTt6eZ8i, every account deleted after):
//     the same key with the same body returns the SAME account, a key differing
//     by one character returns a DIFFERENT one (the negative control), and the
//     same key with a changed body is a hard 400. So a replay after a crash
//     RECOVERS the account instead of minting a second one.
//  2. `StripeConnectAccount.tenantSlug @unique`. Stripe expires an idempotency
//     key after about 24 hours, so guard 1 has a fuse; this one does not.
//
// Split from the code that CALLS Stripe (lib/stripe-connect-accounts.ts) for the
// reason lib/stripe-fee-earned.ts splits its own pure halves out: the two
// decisions that are easy to get wrong — what the key is, and what the write is
// keyed on — are then decidable by a unit test with no DB and no network.

import { db } from "@/lib/db";

/**
 * The registry slug grammar, restated from `provisionSchema` rather than
 * imported, because this is a REFUSAL and not a form check: the schema validates
 * what a founder typed, while this validates what we are about to send to Stripe
 * as an idempotency key. A key built from an empty or exotic string still looks
 * like a key, and Stripe would accept it happily.
 */
const SLUG = /^[a-z0-9][a-z0-9-]{1,30}$/;

/**
 * The account-minting convention this key belongs to. Bumping it is how a
 * DELIBERATE second account is asked for; nothing else may change the key,
 * because a changed key is a new live account (measured — see the header).
 */
export const CONNECT_KEY_SUFFIX = "connect-express-v1";

/**
 * The `Idempotency-Key` for minting this tenant's connected account.
 *
 * Derived from the slug and from nothing else — not from a timestamp, not from a
 * random id, not from the payload — because the whole point is that a SECOND
 * attempt, in a later process, after a crash, computes the same string. It
 * mirrors the convention the runbook already used by hand
 * (`<slug>-connect-standard-v1`), one account type over.
 *
 * @throws if the slug is not registry-shaped. Refusing is the only safe answer:
 *   a key built from a blank slug is `-connect-express-v1`, which is a perfectly
 *   valid key that every blank-slug caller would then share — one Stripe account
 *   handed to whichever tenant asked second.
 */
export function connectExpressIdempotencyKey(slug: string): string {
  if (!SLUG.test(slug)) {
    throw new Error(`refusing to mint a connected account for a non-registry slug: ${JSON.stringify(slug)}`);
  }
  return `${slug}-${CONNECT_KEY_SUFFIX}`;
}

/** One row of `StripeConnectAccount`, exactly as the database takes it. */
export type ConnectAccountRow = {
  tenantSlug: string;
  stripeAccountId: string;
  idempotencyKey: string;
  country: string;
};

/**
 * The WRITE, described as data so its anchor is assertable without a database.
 *
 * `where` is keyed on `stripeAccountId`, so replaying a mint (which returns the
 * same account) updates nothing rather than inserting a twin. The OTHER unique
 * column, `tenantSlug`, is deliberately left to fail: if this row's slug already
 * has a DIFFERENT account, that means a second live account was minted for one
 * restaurant, and the correct behaviour is a loud P2002 that reaches a human —
 * not an upsert that quietly repoints the tenant and abandons the first account.
 *
 * `update` is empty ON PURPOSE, the same as `feeEarnedUpsert`: a replay is the
 * same account with the same country under the same key, so it has nothing new
 * to say and must not be able to restate the row.
 */
export type ConnectAccountUpsert = {
  where: { stripeAccountId: string };
  create: ConnectAccountRow;
  update: Record<string, never>;
};

export function connectAccountUpsert(row: ConnectAccountRow): ConnectAccountUpsert {
  return { where: { stripeAccountId: row.stripeAccountId }, create: row, update: {} };
}

/**
 * The account already minted for this slug, or null.
 *
 * Asked BEFORE Stripe on the mint path, so the ordinary re-run costs one indexed
 * read instead of a network call — and so the answer stays right after the
 * 24-hour idempotency window has closed, which is the only window where Stripe
 * itself would answer wrongly.
 */
export async function findConnectAccountForSlug(slug: string): Promise<ConnectAccountRow | null> {
  const row = await db.stripeConnectAccount.findUnique({
    where: { tenantSlug: slug },
    select: { tenantSlug: true, stripeAccountId: true, idempotencyKey: true, country: true },
  });
  return row;
}

/**
 * Record a minted account. Called immediately after `POST /v1/accounts` returns
 * and before the registry PR is composed.
 *
 * Deliberately NOT swallowing errors. Its callers already own the
 * "never throw at a webhook" rule and turn a failure into a reported outcome; a
 * store that hid a failed write would leave the caller believing the account is
 * recorded when it is not, which is the exact state this table exists to prevent.
 */
export async function recordConnectAccount(row: ConnectAccountRow): Promise<ConnectAccountRow> {
  await db.stripeConnectAccount.upsert(connectAccountUpsert(row));
  return row;
}
