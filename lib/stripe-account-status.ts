// What Stripe last told us about a connected account (ADR-011 amendment, E5).
//
// How this platform learns that a restaurant finished onboarding: a WEBHOOK
// branch, not polling. Polling would mean a fleet-wide `GET /v1/accounts` loop,
// which is exactly the rate-limit shape the backend's StripeAccountClient cache
// comment warns about — and it would still be a snapshot, only a worse one.
//
// The tenant-facing read model does NOT move. `StripeAccountClient` (backend,
// 5-minute cache, derived from `charges_enabled` + `requirements.currently_due`)
// reports Express accounts identically and needs no change. This table is the
// CONTROL plane's copy: it answers "did onboarding finish?" and "is TWINT on
// yet?" for a whole fleet without asking Stripe once per question.
//
// Same split as lib/stripe-fee-earned.ts, and for the same reason: the mapping
// and the write are pure and testable here, the network call is one line at the
// bottom.

import { db } from "@/lib/db";
import { stripeGet } from "@/lib/stripe";

/** The Account fields this module reads. Everything else Stripe returns is ignored. */
export type StripeAccountObject = {
  id: string;
  charges_enabled?: boolean;
  payouts_enabled?: boolean;
  details_submitted?: boolean;
  requirements?: { currently_due?: string[] };
  capabilities?: { twint_payments?: string };
};

/** One row of `StripeAccountStatus`, exactly as the database takes it. */
export type AccountStatusRow = {
  connectedAccountId: string;
  chargesEnabled: boolean;
  payoutsEnabled: boolean;
  detailsSubmitted: boolean;
  requirementsDueCount: number;
  twintCapability: string | null;
  observedAt: Date;
};

/**
 * The whole Stripe-object -> row mapping. PURE apart from the clock, which is
 * passed in for the same reason lib/trial.ts passes `now`: a snapshot's age is
 * the only thing anyone asks about it, so the time it was taken must be
 * assertable rather than ambient.
 *
 * Every optional field falls back to the SAFE side, not to an optimistic one:
 * an account object that omits `charges_enabled` reads as "cannot charge", and
 * one that omits `requirements` reads as "we do not know of any outstanding
 * field", which is 0. The asymmetry is deliberate — a missing capability must
 * never be rendered as a live tenant, while an absent requirements list is
 * genuinely what Stripe sends for an account with nothing due.
 */
export function accountStatusRow(account: StripeAccountObject, observedAt: Date): AccountStatusRow {
  return {
    connectedAccountId: account.id,
    chargesEnabled: account.charges_enabled === true,
    payoutsEnabled: account.payouts_enabled === true,
    detailsSubmitted: account.details_submitted === true,
    // The COUNT, not the list: the field names are Stripe's vocabulary and they
    // change, and the only question ever asked of them here is "is it zero yet".
    requirementsDueCount: account.requirements?.currently_due?.length ?? 0,
    // Null when the account does not list the capability at all, which is a
    // different fact from `inactive` and must not be flattened into it.
    twintCapability: account.capabilities?.twint_payments ?? null,
    observedAt,
  };
}

/**
 * The WRITE, described as data so the anchor is assertable without a database.
 *
 * `where` is keyed on `connectedAccountId`, the column the migration makes
 * UNIQUE — one row per account.
 *
 * `update` carries the WHOLE row, unlike `feeEarnedUpsert`'s deliberately empty
 * one. The difference is what the two tables are: a fee is an immutable event,
 * so a redelivery has nothing new to say; a status is a snapshot, so a second
 * delivery has EVERYTHING to say. Overwriting is safe here only because the
 * caller re-reads the account from Stripe first, so what lands is today's truth
 * regardless of how old the event was.
 */
export type AccountStatusUpsert = {
  where: { connectedAccountId: string };
  create: AccountStatusRow;
  update: Omit<AccountStatusRow, "connectedAccountId">;
};

export function accountStatusUpsert(
  account: StripeAccountObject,
  observedAt: Date,
): AccountStatusUpsert {
  const { connectedAccountId, ...rest } = accountStatusRow(account, observedAt);
  return { where: { connectedAccountId }, create: { connectedAccountId, ...rest }, update: rest };
}

export type AccountStatusResult = { kind: "recorded"; connectedAccountId: string };

/**
 * Record one account's status, taking ONLY its id from the webhook body and
 * re-reading it from Stripe (CLAUDE.md §5.3, fetch-and-verify — the same
 * discipline lib/stripe-fee-earned.ts follows even though the signature is
 * already verified). Here it also buys the idempotency: see the upsert above.
 *
 * PLATFORM lookup, no `Stripe-Account` header. `GET /v1/accounts/{id}` on the
 * platform key is how a platform reads a connected account (measured); sending
 * the header is the obvious way to build this wrong.
 */
export async function recordAccountStatus(accountId: string): Promise<AccountStatusResult> {
  const account = await stripeGet<StripeAccountObject>(`/v1/accounts/${accountId}`);
  const write = accountStatusUpsert(account, new Date());
  await db.stripeAccountStatus.upsert(write);
  return { kind: "recorded", connectedAccountId: write.where.connectedAccountId };
}
