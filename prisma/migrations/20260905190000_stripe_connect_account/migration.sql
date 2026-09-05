-- The Stripe connected account this platform MINTED for a tenant (ADR-011
-- amendment, slice E1). ADR-011 always said each restaurant becomes a connected
-- account via Express onboarding; the implementation shipped Standard accounts
-- created by hand with `curl` (docs/runbooks/signup-to-live-tenant.md §2b.1) and
-- hand-typed into a registry PR. The control plane now mints them, and this
-- table is what makes that safe to do at all.
--
-- WHY IT EXISTS. Minting is a live, billable, externally-visible side effect at
-- Stripe. The registry PR that records `stripe_account:` is composed AFTERWARDS
-- and merged by a human minutes or days later. Until this table there was no
-- Prisma column anywhere holding an `acct_` — the registry YAML was the only
-- tenant -> account map — so a crash in that window lost a real, possibly
-- undeletable Stripe account with nothing anywhere naming it. This row is
-- written IMMEDIATELY after the mint and BEFORE the PR is composed.
--
-- ADDITIVE ONLY, and safe on a DB with live rows: one new table and nothing
-- else. No existing column is retyped, no constraint is dropped, no row changes
-- meaning, and nothing is backfilled — there is nothing to backfill, because no
-- tenant has a `stripe_account` today (`grep -n "^ *stripe_account:"
-- deploy/tenants/registry.yml` returns nothing, exit 1, while the same-shaped
-- `grep -c "^ *modules:"` on the same file returns 6, so the instrument
-- discriminates and the zero is real). The migration cost of the account-type
-- change is exactly zero.
--
-- A DEDICATED TABLE, not a column on "TenantBilling", for three reasons:
--   1. "TenantBilling" exists only for a tenant that has a BILLING PLAN. The
--      founder path (/admin/provision) stands a tenant up with no such row at
--      all and it mints accounts too, so a column there could not hold them.
--   2. This is the third table of a shape this app already has twice —
--      "StripeFeeRefund" (20260904120000) and "StripeApplicationFee"
--      (20260905000000): keyed on a Stripe id, joined back to a tenant at READ
--      time, never by a foreign key (ADR-007, the registry is the source of
--      truth and this app never writes to it).
--   3. An account has its own lifecycle facts to record later (onboarding
--      progress, capabilities) which have nothing to do with a subscription.
--
-- THREE UNIQUE COLUMNS, and they are not redundant.
--
-- "tenantSlug" is the DURABLE one-account-per-tenant guard. It is what still
-- holds tomorrow: Stripe expires an idempotency key after about 24 hours
-- (documented by Stripe, not measurable from here), so a replay a day later
-- would otherwise mint a second live account for the same restaurant.
--
-- "stripeAccountId" is the idempotency anchor for everything written ABOUT the
-- account afterwards, the same role "StripeApplicationFee"."applicationFeeId"
-- plays: a repeated delivery of the same fact upserts on it and so can restate
-- the row but never split it in two.
--
-- "idempotencyKey" records the `Idempotency-Key` the mint was actually sent
-- with (`<slug>-connect-express-v1`), rather than leaving it merely derivable.
-- MEASURED 2026-09-05 against the test platform acct_1TpwTNCAHTt6eZ8i, with a
-- negative control, all accounts deleted afterwards (GET -> 403):
--   * same key + same body   -> the SAME account (acct_1UCOkhCSPiP2JWOQ, twice)
--   * key changed by one char -> a DIFFERENT account (acct_1UCOkpFoEuSsk6t2)
--   * same key + changed body -> HTTP 400 "Keys for idempotent requests can only
--     be used with the same parameters they were first used with"
-- So the key IS the mechanism, the prefill payload is part of it, and a change
-- of convention has to be visible in the data rather than only in the code that
-- happens to be deployed. A future `-v2` is then readable as a `-v2`.
--
-- "country" is recorded rather than re-read because Stripe fixes it at creation
-- (as it fixes the account type): it is the field a wrong tenant address would
-- have silently baked into a live account.
--
-- No index beyond the three unique constraints. Every read is by one of them —
-- by slug when provisioning asks "does this tenant already have an account",
-- by `acct_` when Stripe tells us something about one.

CREATE TABLE "StripeConnectAccount" (
  "id"              TEXT NOT NULL,
  "tenantSlug"      TEXT NOT NULL,
  "stripeAccountId" TEXT NOT NULL,
  "idempotencyKey"  TEXT NOT NULL,
  "country"         TEXT NOT NULL,
  "createdAt"       TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "StripeConnectAccount_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "StripeConnectAccount_tenantSlug_key"
  ON "StripeConnectAccount"("tenantSlug");
CREATE UNIQUE INDEX "StripeConnectAccount_stripeAccountId_key"
  ON "StripeConnectAccount"("stripeAccountId");
CREATE UNIQUE INDEX "StripeConnectAccount_idempotencyKey_key"
  ON "StripeConnectAccount"("idempotencyKey");
