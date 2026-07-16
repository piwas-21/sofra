-- Direct restaurant signup intake (ADR-004 self-serve v1). Additive: a new
-- lead-queue table + status enum; nothing existing is touched.

-- CreateEnum
CREATE TYPE "SignupStatus" AS ENUM ('NEW', 'CONTACTED', 'CONVERTED', 'DECLINED');

-- CreateTable
CREATE TABLE "SignupRequest" (
    "id" TEXT NOT NULL,
    "restaurantName" TEXT NOT NULL,
    "contactName" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "phone" TEXT,
    "city" TEXT,
    "desiredSlug" TEXT,
    "message" TEXT,
    "locale" TEXT NOT NULL DEFAULT 'en',
    "status" "SignupStatus" NOT NULL DEFAULT 'NEW',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "decidedAt" TIMESTAMP(3),

    CONSTRAINT "SignupRequest_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "SignupRequest_status_createdAt_idx" ON "SignupRequest"("status", "createdAt");
