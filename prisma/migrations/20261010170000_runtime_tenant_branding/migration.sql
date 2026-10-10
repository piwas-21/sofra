CREATE TABLE "TenantBranding" (
    "tenantSlug" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "TenantBranding_pkey" PRIMARY KEY ("tenantSlug")
);
