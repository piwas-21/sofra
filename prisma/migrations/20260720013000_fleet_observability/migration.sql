-- Fleet observability roll-up (docs/plans/PRINTER-APP-FLEET-OBSERVABILITY-PLAN.md).
-- Additive: two new tables that receive a one-directional, bearer-authed per-tenant
-- snapshot from each tenant backend. Keyed on the registry slug (not a FK). Non-PII.

-- Per-tenant summary (one row per tenant, upserted on each push).
CREATE TABLE "FleetSummary" (
  "id"           TEXT NOT NULL,
  "tenantSlug"   TEXT NOT NULL,
  "deviceCount"  INTEGER NOT NULL DEFAULT 0,
  "missedOrders" INTEGER NOT NULL DEFAULT 0,
  "recentErrors" INTEGER NOT NULL DEFAULT 0,
  "reportedAt"   TIMESTAMP(3) NOT NULL,
  "receivedAt"   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"    TIMESTAMP(3) NOT NULL,
  CONSTRAINT "FleetSummary_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "FleetSummary_tenantSlug_key" ON "FleetSummary"("tenantSlug");

-- Per-device roster row (one per tenant+device; upserted, stale devices pruned on push).
CREATE TABLE "FleetDevice" (
  "id"                   TEXT NOT NULL,
  "tenantSlug"           TEXT NOT NULL,
  "deviceId"             TEXT NOT NULL,
  "label"                TEXT,
  "platform"             TEXT,
  "appVersion"           TEXT,
  "feedRunning"          BOOLEAN NOT NULL DEFAULT false,
  "lastHeartbeatAt"      TIMESTAMP(3),
  "lastSuccessfulPollAt" TIMESTAMP(3),
  "apiBaseUrl"           TEXT,
  "kitchenPrinter"       TEXT,
  "cashierPrinter"       TEXT,
  "updatedAt"            TIMESTAMP(3) NOT NULL,
  CONSTRAINT "FleetDevice_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "FleetDevice_tenantSlug_deviceId_key" ON "FleetDevice"("tenantSlug", "deviceId");
CREATE INDEX "FleetDevice_tenantSlug_idx" ON "FleetDevice"("tenantSlug");
