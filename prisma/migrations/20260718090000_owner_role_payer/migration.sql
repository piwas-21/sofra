-- OWNER role + explicit billing payer (ADR-004 direct self-serve). Additive:
-- a new enum value + a nullable FK column; no existing rows are touched.
--
-- A direct restaurant OWNER pays for their own tenant with no reseller Client
-- (SOFRA-PARTNER-PLAN's third actor). TenantBilling.payerUserId names that payer
-- explicitly, decoupled from the CRM Client.partnerId used by the reseller flow.

-- AlterEnum: add OWNER. IF NOT EXISTS makes this migration re-runnable; PG16
-- allows ADD VALUE inside the migration transaction (the value just can't be
-- USED until commit — this migration never inserts an OWNER row, so it's safe).
ALTER TYPE "UserRole" ADD VALUE IF NOT EXISTS 'OWNER';

-- AlterTable: explicit payer FK. ON DELETE SET NULL mirrors clientId — deleting
-- a user must not cascade-delete billing history.
ALTER TABLE "TenantBilling" ADD COLUMN "payerUserId" TEXT;

ALTER TABLE "TenantBilling" ADD CONSTRAINT "TenantBilling_payerUserId_fkey"
  FOREIGN KEY ("payerUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE INDEX "TenantBilling_payerUserId_idx" ON "TenantBilling"("payerUserId");
