CREATE TABLE "PrinterCredential" (
    "tenantSlug" TEXT NOT NULL,
    "box" TEXT NOT NULL,
    "keyCipher" TEXT,
    "keyFingerprint" TEXT,
    "pendingCipher" TEXT,
    "pendingFingerprint" TEXT,
    "requestedAt" TIMESTAMP(3),
    "lastSyncedAt" TIMESTAMP(3) NOT NULL,
    "verified" BOOLEAN NOT NULL DEFAULT false,
    "renewable" BOOLEAN NOT NULL DEFAULT false,
    "renewalFailed" BOOLEAN NOT NULL DEFAULT false,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "PrinterCredential_pkey" PRIMARY KEY ("tenantSlug")
);
