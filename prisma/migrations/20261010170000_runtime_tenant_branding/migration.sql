CREATE TABLE "TenantBranding" (
    "tenantSlug" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "TenantBranding_pkey" PRIMARY KEY ("tenantSlug")
);
