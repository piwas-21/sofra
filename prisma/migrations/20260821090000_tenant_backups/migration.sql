-- Tenant backups — the owner's window onto backups that already exist
-- (workspace ROADMAP Track S; sofra docs/adr/ADR-014-tenant-backup-visibility.md).
--
-- ADDITIVE ONLY, and that is a requirement rather than a preference: this runs
-- against a database with live rows (RUMI, two live plans, PartnerDomain). Four
-- new types and three new tables; not one existing table, column, index or
-- constraint is touched, so there is nothing to backfill and nothing that can
-- fail on existing data. The one FK added points FROM a new table
-- ("BackupJob"."requestedById" -> "User") and is nullable + ON DELETE SET NULL,
-- so it cannot block a user delete either.
--
-- Nothing here takes a backup. Both boxes have dumped nightly at 02:15 and
-- shipped cross-box into encrypted restic repositories at 03:00 since long
-- before this migration; these tables are the inventory of what already exists,
-- plus a queue the box POLLS. Every credential in this feature points
-- BOX -> SOFRA (ADR-012 invariant 2) — the control plane holds nothing that can
-- reach a box.
--
-- PII: metadata only (slugs, sizes, timestamps, snapshot refs, checksums). A
-- dump's contents never enter this database.

CREATE TYPE "BackupKind" AS ENUM ('SCHEDULED', 'MANUAL', 'DEPROVISION', 'ARCHIVE');
CREATE TYPE "BackupLocation" AS ENUM ('RESTIC', 'LOCAL');
CREATE TYPE "BackupJobAction" AS ENUM ('CREATE', 'DELETE');
CREATE TYPE "BackupJobStatus" AS ENUM ('PENDING', 'CLAIMED', 'DONE', 'FAILED');

-- One row per box: when it last told us anything at all. Separate from the
-- artifacts on purpose — an emptied repository reports an EMPTY inventory, and
-- without this row "reported, and it is empty" is indistinguishable from silence.
CREATE TABLE "BackupInventory" (
  "id"            TEXT NOT NULL,
  "box"           TEXT NOT NULL,
  "reportedAt"    TIMESTAMP(3) NOT NULL,
  "receivedAt"    TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "artifactCount" INTEGER NOT NULL DEFAULT 0,
  "updatedAt"     TIMESTAMP(3) NOT NULL,
  CONSTRAINT "BackupInventory_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "BackupInventory_box_key" ON "BackupInventory"("box");

-- Keyed on the registry slug, NOT a foreign key. Load-bearing here rather than
-- incidental: artifacts are deliberately KEPT for tenants that no longer have a
-- registry entry, and a FK would delete exactly the departed customer's backup
-- this feature exists to preserve.
--
-- sizeBytes is BIGINT: INTEGER caps at 2.1 GB, which a tenant dump will pass.
CREATE TABLE "BackupArtifact" (
  "id"          TEXT NOT NULL,
  "box"         TEXT NOT NULL,
  "tenantSlug"  TEXT NOT NULL,
  "kind"        "BackupKind" NOT NULL,
  "location"    "BackupLocation" NOT NULL,
  "ref"         TEXT NOT NULL,
  "takenAt"     TIMESTAMP(3) NOT NULL,
  "sizeBytes"   BIGINT NOT NULL,
  "sha256"      TEXT,
  "firstSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  -- Mark-and-sweep marker (see lib/backup-inventory.ts): re-stamped on every
  -- push that still lists the artifact, so the whole-box upsert can delete what
  -- was not re-marked without the payload having to name what is missing.
  "lastSeenAt"  TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"   TIMESTAMP(3) NOT NULL,
  CONSTRAINT "BackupArtifact_pkey" PRIMARY KEY ("id")
);

-- The natural key on the wire: `ref` alone is not unique (a local filename can
-- repeat across boxes; the same restic id can appear in two repositories), so
-- the triple is what makes a whole-box push an idempotent upsert.
CREATE UNIQUE INDEX "BackupArtifact_box_location_ref_key"
  ON "BackupArtifact"("box", "location", "ref");
CREATE INDEX "BackupArtifact_tenantSlug_idx" ON "BackupArtifact"("tenantSlug");
CREATE INDEX "BackupArtifact_box_idx" ON "BackupArtifact"("box");

-- Work the founder has asked a box to do. The box POLLS this; sofra never
-- initiates a connection toward a box.
CREATE TABLE "BackupJob" (
  "id"            TEXT NOT NULL,
  "box"           TEXT NOT NULL,
  "action"        "BackupJobAction" NOT NULL,
  "tenantSlug"    TEXT NOT NULL,
  "ref"           TEXT,
  "status"        "BackupJobStatus" NOT NULL DEFAULT 'PENDING',
  "reason"        TEXT,
  "override"      BOOLEAN NOT NULL DEFAULT false,
  "requestedById" TEXT,
  "claimedAt"     TIMESTAMP(3),
  "finishedAt"    TIMESTAMP(3),
  "error"         TEXT,
  "createdAt"     TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"     TIMESTAMP(3) NOT NULL,
  CONSTRAINT "BackupJob_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "BackupJob_box_status_idx" ON "BackupJob"("box", "status");
CREATE INDEX "BackupJob_tenantSlug_idx" ON "BackupJob"("tenantSlug");

-- SET NULL, not CASCADE: deleting the admin account must not erase the record
-- that a destructive job was requested. The audit trail outlives the actor.
ALTER TABLE "BackupJob"
  ADD CONSTRAINT "BackupJob_requestedById_fkey"
  FOREIGN KEY ("requestedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
