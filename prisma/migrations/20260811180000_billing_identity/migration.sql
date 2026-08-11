-- Billing identity: the legal entity an invoice is addressed to.
-- (workspace docs/plans/SOFRA-BILLING-IDENTITY-PLAN.md, B1.)
--
-- Until now the control plane stored a NAME and an EMAIL for everyone it charges
-- — `TenantBilling.name`/`email`, and a nullable free-text `PartnerProfile.company`
-- with no country, address or tax identifier attached to it. That is not enough to
-- issue an invoice at all, and nowhere near enough to decide what VAT applies:
-- the same two fields describe a Swiss tenant (outside the scope of EU VAT) and a
-- French partner (reverse-charged), which are different sales in law.
--
-- WHY A SEPARATE TABLE, rather than columns on TenantBilling:
-- one party can hold several tenants — /admin/onboard REUSES an existing ACTIVE
-- partner by design, so a reseller with three restaurants is one legal entity with
-- three subscriptions. Legal fields on TenantBilling would be copied three times and
-- drift, and the first divergence would surface as two invoices to the same company
-- carrying different addresses. TenantBilling.billingIdentityId points here instead.
--
-- ADDITIVE AND NULLABLE THROUGHOUT — every existing row keeps working:
--   * BillingIdentity is a new table, so nothing is backfilled by this migration.
--   * TenantBilling.billingIdentityId is nullable, and NULL is the honest state for
--     every row that predates it (RUMI included). No identity can be invented from
--     a name and an email; the founder enters it, and until then the row simply
--     cannot be invoiced. That is the intended interlock, not a gap.
--
-- ON DELETE SET NULL on BOTH foreign keys, mirroring TenantBilling.payerUserId and
-- .clientId: deleting a user or an identity must never cascade into billing history.
-- Note this is the right rule HERE and will be the wrong rule for Invoice (B4) —
-- an issued invoice must pin its identity, so that FK will RESTRICT.
--
-- vatStatus is deliberately five-valued. UNAVAILABLE ("VIES could not answer") is
-- NOT a synonym for INVALID and must never overwrite a VALID: VIES serializes its
-- own outages as `valid:false` too — the French node throttled 5 of 8 calls during
-- the plan's research while its status endpoint reported it Available — so a
-- collapsed enum turns a busy member state into a rejected customer, and silently
-- retracts a reverse charge that was substantiated correctly last quarter.

-- CreateEnum
CREATE TYPE "VatStatus" AS ENUM ('NONE', 'UNCHECKED', 'VALID', 'INVALID', 'UNAVAILABLE');

-- CreateTable
CREATE TABLE "BillingIdentity" (
    "id"             TEXT NOT NULL,
    "userId"         TEXT,
    "legalName"      TEXT NOT NULL,
    "tradeName"      TEXT,
    "legalForm"      TEXT,
    "registrationNo" TEXT,
    "addressLine1"   TEXT NOT NULL,
    "addressLine2"   TEXT,
    "postalCode"     TEXT NOT NULL,
    "city"           TEXT NOT NULL,
    "countryCode"    TEXT NOT NULL,
    "billingEmail"   TEXT NOT NULL,
    "vatNumber"      TEXT,
    "vatStatus"      "VatStatus" NOT NULL DEFAULT 'NONE',
    "vatCheckedAt"   TIMESTAMP(3),
    "vatCheckRef"    TEXT,
    "vatCheckDetail" TEXT,
    "vatCheckName"   TEXT,
    "createdAt"      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt"      TIMESTAMP(3) NOT NULL,

    CONSTRAINT "BillingIdentity_pkey" PRIMARY KEY ("id")
);

-- One identity per user: a party has one set of registration details at a time.
-- Postgres allows multiple NULLs, which is what lets founder-recorded identities
-- (no account yet) coexist.
CREATE UNIQUE INDEX "BillingIdentity_userId_key" ON "BillingIdentity"("userId");

-- Drives the ICP listing (B7): reverse-charged EU sales, grouped by country.
CREATE INDEX "BillingIdentity_countryCode_vatStatus_idx"
  ON "BillingIdentity"("countryCode", "vatStatus");

ALTER TABLE "BillingIdentity"
  ADD CONSTRAINT "BillingIdentity_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "User"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

-- AlterTable
ALTER TABLE "TenantBilling" ADD COLUMN "billingIdentityId" TEXT;

CREATE INDEX "TenantBilling_billingIdentityId_idx"
  ON "TenantBilling"("billingIdentityId");

ALTER TABLE "TenantBilling"
  ADD CONSTRAINT "TenantBilling_billingIdentityId_fkey"
  FOREIGN KEY ("billingIdentityId") REFERENCES "BillingIdentity"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;
