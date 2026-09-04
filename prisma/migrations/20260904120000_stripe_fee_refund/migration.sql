-- Stripe Connect fee refunds (ADR-011 amendment, consequence 1 — "fee
-- follows the refund"). Stripe never auto-refunds an application fee when a
-- connected account refunds a charge — the connected account "loses that
-- amount", in Stripe's own words. Sofra is the platform, so it is the only
-- party that CAN return it, which is what the one platform-level Connect
-- webhook (app/api/webhooks/stripe/route.ts, lib/stripe-fee-refund.ts) now
-- does. This table is the record of every fee refund it has issued.
--
-- ADDITIVE ONLY: one new table, no existing column, index or constraint
-- touched, nothing to backfill.
--
-- `stripeRefundId` is UNIQUE and is the natural idempotency anchor — Stripe's
-- own refund id (`fr_...`), one row per refund Stripe actually created. A
-- webhook redelivery recomputes the same due amount from the CURRENT
-- (already-updated) fee state and gets 0 due before this table is ever
-- touched; the unique constraint is the second line of defence for the race
-- where two concurrent deliveries both read the fee before either write
-- landed — they share one Stripe idempotency key
-- (`feerefund:{feeId}:{target}`, keyed on the TARGET so both compute the
-- same one) and so get back the SAME `fr_...` id, and the write path upserts
-- on it rather than inserting twice.
--
-- `connectedAccountId` and `chargeId` are NOT foreign keys — same seam as
-- "TenantBilling"."tenantSlug" and "BackupArtifact"."tenantSlug" (ADR-007):
-- the registry (which maps a tenant's `stripe_account` back to a slug) is
-- the source of truth and this app never writes to it, so the join back to a
-- tenant happens at READ time, not by an FK here.
--
-- The columns beyond the idempotency anchor (amount, currency,
-- connectedAccountId, createdAt) are exactly what ADR-011's SECOND recorded
-- consequence — "no commission reporting surface" — will need: a future
-- per-tenant revenue readout groups these rows by connectedAccountId (joined
-- back to a tenant slug via the registry's `stripe_account` field at read
-- time) and sums `amount` as money RETURNED, next to whatever future table
-- records money EARNED. This table seeds that gap; it does not close it.

CREATE TABLE "StripeFeeRefund" (
  "id"                 TEXT NOT NULL,
  "stripeRefundId"     TEXT NOT NULL,
  "applicationFeeId"   TEXT NOT NULL,
  "connectedAccountId" TEXT NOT NULL,
  "chargeId"           TEXT NOT NULL,
  "amount"             INTEGER NOT NULL,
  "currency"           TEXT NOT NULL,
  "createdAt"          TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "StripeFeeRefund_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "StripeFeeRefund_stripeRefundId_key" ON "StripeFeeRefund"("stripeRefundId");
CREATE INDEX "StripeFeeRefund_connectedAccountId_idx" ON "StripeFeeRefund"("connectedAccountId");
CREATE INDEX "StripeFeeRefund_chargeId_idx" ON "StripeFeeRefund"("chargeId");
