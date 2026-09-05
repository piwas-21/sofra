-- Application fees EARNED (workspace docs/plans/BACKLOG.md, the SECOND blocker
-- before any tenant goes on a non-zero payment commission: "nothing reports
-- what the commission earned").
--
-- The mirror image of "StripeFeeRefund" (20260904120000), whose own header
-- names this table as the missing half: it records money RETURNED and says in
-- as many words that it "seeds that gap; it does not close it". Written by the
-- `application_fee.created` branch of app/api/webhooks/stripe/route.ts
-- (lib/stripe-fee-earned.ts).
--
-- ADDITIVE ONLY, and safe on a DB with live rows: one new table plus one
-- NULLABLE column on "StripeFeeRefund". No existing column is retyped, no
-- constraint is dropped, nothing is backfilled, and no existing row changes
-- meaning. The new column stays NULL for the two rows the staging runbook
-- created, which is the honest state — Stripe's own refund timestamp was never
-- captured for them and cannot be invented after the fact.
--
-- "applicationFeeId" is UNIQUE and is the idempotency anchor: Stripe's own fee
-- id (`fee_...`), one row per ApplicationFee Stripe actually created. It carries
-- MORE weight than "StripeFeeRefund"."stripeRefundId" does. The refund path is
-- idempotent three times over (the proration recomputes to zero on redelivery,
-- the Stripe Idempotency-Key is derived from the target, and only THEN the
-- unique index), whereas a "record what happened" write has no arithmetic that
-- neutralises a second delivery. Here the constraint is the ONLY thing standing
-- between a Stripe redelivery and double-counted revenue, and the write path
-- upserts on it rather than inserting.
--
-- "connectedAccountId" and "chargeId" are NOT foreign keys — same seam as
-- "StripeFeeRefund" and "TenantBilling"."tenantSlug" (ADR-007): the registry
-- (which maps a tenant's `stripe_account` back to a slug) is the source of truth
-- and this app never writes to it, so the join back to a tenant happens at READ
-- time. A fee for an account no registry entry names is still recorded — the
-- money was earned whether or not we can name the tenant yet — and
-- lib/commission-earnings.ts reports such an account rather than dropping it.
--
-- "amount" is the fee as CREATED and is never updated. Stripe leaves it
-- immutable and moves `amount_refunded` instead; storing that here would be a
-- snapshot that silently goes stale, and the refunded side already has its own
-- table. "currency" is the CHARGE's currency (chf for a Swiss tenant), NOT
-- Sofra's EUR books — the two must never be summed together, which is why the
-- readout groups by it instead of totalling.
--
-- "feeCreatedAt" is Stripe's own clock (epoch seconds, converted at the write);
-- "createdAt" is ours. Periodisation uses Stripe's, so a redelivery days later
-- cannot move a fee into a later month.
--
-- The event that fills this table is a PLATFORM event — MEASURED 2026-09-04
-- against the API: `application_fee.created` carries `account: null` and never
-- reaches the `connect: true` endpoint that carries `charge.refunded`. It
-- arrives on a SECOND, account-scoped endpoint at the same URL, with its own
-- `whsec_` (STRIPE_ACCOUNT_WEBHOOK_SECRET). Until that endpoint exists at
-- Stripe this table stays correctly empty.

CREATE TABLE "StripeApplicationFee" (
  "id"                 TEXT NOT NULL,
  "applicationFeeId"   TEXT NOT NULL,
  "connectedAccountId" TEXT NOT NULL,
  "chargeId"           TEXT NOT NULL,
  "amount"             INTEGER NOT NULL,
  "currency"           TEXT NOT NULL,
  "feeCreatedAt"       TIMESTAMP(3) NOT NULL,
  "createdAt"          TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "StripeApplicationFee_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "StripeApplicationFee_applicationFeeId_key"
  ON "StripeApplicationFee"("applicationFeeId");
CREATE INDEX "StripeApplicationFee_connectedAccountId_feeCreatedAt_idx"
  ON "StripeApplicationFee"("connectedAccountId", "feeCreatedAt");
CREATE INDEX "StripeApplicationFee_chargeId_idx"
  ON "StripeApplicationFee"("chargeId");

-- Give the refunded side Stripe's clock too, so "earned minus refunded over a
-- period" periodises BOTH halves on the same clock instead of comparing
-- Stripe's timestamp against our insert time. Nullable and un-backfilled, per
-- the paragraph above. Verified against the API before relying on it: a
-- `fee_refund` object does carry `created` (epoch seconds) — it was simply
-- never typed in lib/stripe-fee-refund.ts.
ALTER TABLE "StripeFeeRefund" ADD COLUMN "feeRefundedAt" TIMESTAMP(3);
