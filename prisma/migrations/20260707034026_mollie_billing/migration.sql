-- CreateEnum
CREATE TYPE "SubscriptionStatus" AS ENUM ('PENDING', 'ACTIVATING', 'ACTIVE', 'CANCELED', 'SUSPENDED', 'COMPLETED');

-- AlterTable
ALTER TABLE "CommissionEntry" ALTER COLUMN "currency" SET DEFAULT 'EUR';

-- CreateTable
CREATE TABLE "TenantBilling" (
    "id" TEXT NOT NULL,
    "tenantSlug" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "mollieCustomerId" TEXT NOT NULL,
    "clientId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TenantBilling_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BillingSubscription" (
    "id" TEXT NOT NULL,
    "billingId" TEXT NOT NULL,
    "mollieSubscriptionId" TEXT,
    "description" TEXT NOT NULL,
    "amountCents" INTEGER NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'EUR',
    "interval" TEXT NOT NULL DEFAULT '1 month',
    "status" "SubscriptionStatus" NOT NULL DEFAULT 'PENDING',
    "startDate" TIMESTAMP(3),
    "canceledAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "BillingSubscription_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BillingPayment" (
    "id" TEXT NOT NULL,
    "billingId" TEXT NOT NULL,
    "molliePaymentId" TEXT NOT NULL,
    "mollieSubscriptionId" TEXT,
    "amountCents" INTEGER NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'EUR',
    "description" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "sequenceType" TEXT NOT NULL,
    "method" TEXT,
    "checkoutUrl" TEXT,
    "paidAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "BillingPayment_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "TenantBilling_tenantSlug_key" ON "TenantBilling"("tenantSlug");

-- CreateIndex
CREATE UNIQUE INDEX "TenantBilling_mollieCustomerId_key" ON "TenantBilling"("mollieCustomerId");

-- CreateIndex
CREATE UNIQUE INDEX "TenantBilling_clientId_key" ON "TenantBilling"("clientId");

-- CreateIndex
CREATE UNIQUE INDEX "BillingSubscription_mollieSubscriptionId_key" ON "BillingSubscription"("mollieSubscriptionId");

-- CreateIndex
CREATE INDEX "BillingSubscription_billingId_createdAt_idx" ON "BillingSubscription"("billingId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "BillingPayment_molliePaymentId_key" ON "BillingPayment"("molliePaymentId");

-- CreateIndex
CREATE INDEX "BillingPayment_billingId_createdAt_idx" ON "BillingPayment"("billingId", "createdAt");

-- AddForeignKey
ALTER TABLE "TenantBilling" ADD CONSTRAINT "TenantBilling_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "Client"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BillingSubscription" ADD CONSTRAINT "BillingSubscription_billingId_fkey" FOREIGN KEY ("billingId") REFERENCES "TenantBilling"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BillingPayment" ADD CONSTRAINT "BillingPayment_billingId_fkey" FOREIGN KEY ("billingId") REFERENCES "TenantBilling"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Data fix: Sofra's books flipped CHF -> EUR on 2026-07-06 (NL company; the
-- app has rendered/entered EUR since), but rows created before this migration
-- kept the stale CHF default. The prod ledger was empty at the flip, so this
-- relabel is safe; any dev rows were EUR entered as CHF-labeled.
UPDATE "CommissionEntry" SET "currency" = 'EUR' WHERE "currency" = 'CHF';
