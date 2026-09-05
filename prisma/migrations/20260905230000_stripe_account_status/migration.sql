-- What Stripe last told us about a connected account (ADR-011 amendment, E5).
-- Written by the `account.updated` branch of app/api/webhooks/stripe/route.ts,
-- which is how this platform learns that a restaurant finished onboarding —
-- a WEBHOOK, not polling. Polling would mean a fleet-wide `GET /v1/accounts`
-- loop, which is exactly the rate-limit shape the backend's StripeAccountClient
-- cache comment already warns about.
--
-- ADDITIVE ONLY, and safe on a DB with live rows: one new table. No column is
-- retyped, no constraint is dropped, no row changes meaning, nothing is
-- backfilled — and nothing CAN be: this table records observations, and no
-- observation was made before it existed. An empty table is the honest state.
--
-- A SEPARATE TABLE from "StripeConnectAccount" (20260905190000), which records
-- the accounts this platform MINTED. An account we did not mint can still send
-- this event — the hand-run `curl` in docs/runbooks/signup-to-live-tenant.md
-- §2b.1 made some — and dropping its status because we cannot name its tenant
-- would be the same mistake "StripeApplicationFee"'s header refuses to make
-- about money. The join back to a tenant happens at READ time (ADR-007), as it
-- does for both fee tables.
--
-- "connectedAccountId" is UNIQUE and is the idempotency anchor: one row per
-- account, upserted. Unlike the fee tables, the row is MEANT to be overwritten —
-- it is a cache of an observation, not a ledger entry. That is only safe because
-- the write path takes the account ID from the event and RE-READS the account
-- from Stripe (CLAUDE.md §5.3, fetch-and-verify, the same discipline
-- lib/stripe-fee-earned.ts follows). So a redelivery of a stale event writes
-- TODAY's truth rather than yesterday's, and no event ordering has to be
-- reasoned about anywhere. Trusting the event body instead would have made a
-- redelivered "not yet enabled" silently un-do a tenant that is live.
--
-- "chargesEnabled" and "payoutsEnabled" are stored separately because they move
-- independently: a restaurant taking cards whose payouts are blocked is a
-- support call nobody would otherwise see coming. "detailsSubmitted" is neither
-- of them — an account under review has submitted everything and still cannot
-- charge — and it is the field that decides which link /onboarding/payments
-- mints, because Stripe REFUSES a login link before onboarding completes
-- (measured 2026-09-05: 400 "Cannot create a login link for an account that has
-- not completed onboarding").
--
-- "requirementsDueCount" is the COUNT of `requirements.currently_due`, not the
-- list. The field names are Stripe's vocabulary and they change; the only
-- question ever asked of them here is "is it zero yet". Measured on a CH Express
-- account: 16 bare, 13 prefilled without a business type, 6 fully prefilled.
--
-- "twintCapability" is nullable because an account may not list the capability
-- at all. It is recorded because TWINT has a Stripe-side approval queue behind
-- it, so "the tenant is live but TWINT is not" is a real state that nothing else
-- in the fleet reports.
--
-- "observedAt" is OUR clock, and here that is the right one — the opposite of
-- the two fee tables, which periodise on Stripe's. Those record events that
-- happened at a Stripe timestamp; this records a snapshot, and what matters
-- about a snapshot is how old it is.

CREATE TABLE "StripeAccountStatus" (
  "id"                   TEXT NOT NULL,
  "connectedAccountId"   TEXT NOT NULL,
  "chargesEnabled"       BOOLEAN NOT NULL,
  "payoutsEnabled"       BOOLEAN NOT NULL,
  "detailsSubmitted"     BOOLEAN NOT NULL,
  "requirementsDueCount" INTEGER NOT NULL,
  "twintCapability"      TEXT,
  "observedAt"           TIMESTAMP(3) NOT NULL,
  "createdAt"            TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "StripeAccountStatus_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "StripeAccountStatus_connectedAccountId_key"
  ON "StripeAccountStatus"("connectedAccountId");
