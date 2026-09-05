-- Payments pricing mode: flat fee or per-transaction commission
-- (workspace docs/plans/SOFRA-PAYMENTS-PRICING-MODE-PLAN.md, S1).
--
-- Two columns on TenantBilling — the BILLING truth for how a tenant is charged
-- for online payments. The registry's own `payments_commission_bps`
-- (deploy repo tenants/registry.yml, read by lib/provisioning-registry.ts) is
-- the separate ENFORCEMENT truth: what actually reaches the tenant's backend
-- and is sent to Stripe as `application_fee_amount`. The two are allowed to
-- disagree during the registry-PR window (this app proposes a PR, it never
-- writes to a box — ADR-003/007) and are reconciled only when that PR merges
-- and the tenant is re-provisioned.
--
-- ADDITIVE AND SAFE ON A DB WITH LIVE ROWS: two new columns, both with
-- defaults, on an existing table — no rewrite of any other column, no
-- backfill, no data loss. `paymentsMode` defaults to 'flat' and
-- `paymentsCommissionBps` defaults to 0, which is what EVERY existing
-- TenantBilling row already means today (flat-fee, no commission) — so this
-- changes billing for precisely nobody until someone deliberately switches a
-- tenant. NOT NULL is safe with a default on Postgres because the column is
-- backfilled from the default for existing rows as part of adding it.
--
-- No CHECK constraint on paymentsCommissionBps's range (0-1000, 10% ceiling):
-- that ceiling is enforced in application code (lib/payments-pricing.ts,
-- MAX_COMMISSION_BPS) and re-checked independently in provision-tenant.sh and
-- the backend before it can ever reach Stripe, so a DB-level constraint would
-- be a fourth copy of the same rule rather than the one place it is missing.

ALTER TABLE "TenantBilling"
  ADD COLUMN "paymentsMode" TEXT NOT NULL DEFAULT 'flat',
  ADD COLUMN "paymentsCommissionBps" INTEGER NOT NULL DEFAULT 0;
