// Ingest for a whole box's backup inventory (POST /api/telemetry/backups).
//
// The DB half of the contract; the schemas it validates against live in
// lib/backup-contract.ts, which imports nothing but zod so the wire rules stay
// inside the unit coverage floor. Same split as fleet's and vies/vies-result's.
//
// Direction: BOX -> SOFRA, always. This module never reaches toward a box.

import { db } from "@/lib/db";
import { BackupKind, BackupLocation } from "@/lib/generated/prisma/client";
import type { BackupArtifactInput, BackupInventoryPush } from "@/lib/backup-contract";

/** Wire (lowercase) -> Prisma enum. Exhaustive by type: adding a kind to
 *  BACKUP_KINDS without adding it here is a compile error, not a runtime 500. */
const KIND: Record<BackupArtifactInput["kind"], BackupKind> = {
  scheduled: BackupKind.SCHEDULED,
  manual: BackupKind.MANUAL,
  deprovision: BackupKind.DEPROVISION,
  archive: BackupKind.ARCHIVE,
};

const LOCATION: Record<BackupArtifactInput["location"], BackupLocation> = {
  restic: BackupLocation.RESTIC,
  local: BackupLocation.LOCAL,
};

export type BackupIngestResult = {
  /** How many artifacts this box now claims. */
  artifacts: number;
  /** How many rows this box previously had that it no longer lists. */
  removed: number;
};

function columns(a: BackupArtifactInput, seenAt: Date) {
  return {
    tenantSlug: a.tenantSlug,
    kind: KIND[a.kind],
    takenAt: a.takenAt,
    sizeBytes: BigInt(a.sizeBytes),
    sha256: a.sha256 ?? null,
    lastSeenAt: seenAt,
  };
}

/**
 * Upsert a whole box's inventory, idempotently.
 *
 * MARK AND SWEEP, in one transaction: every listed artifact is upserted with
 * `lastSeenAt = now`, then this box's rows that were NOT re-marked are deleted.
 * The alternative — a `NOT IN` over the reported (location, ref) pairs — builds
 * a query proportional to the payload and is the same amount of correctness for
 * more SQL.
 *
 * PRUNING IS THE POINT, not a side effect. An artifact the box stops listing has
 * ceased to exist, and its row must go, because the failure this page exists to
 * catch is a repository that has quietly emptied. Keeping unlisted rows would
 * make that invisible — the one thing a backup page must never do. The cost is
 * that a PARTIAL push (the agent's restic listing failed, its local listing
 * succeeded) reads as destruction and shows red. That is the correct direction
 * to be wrong in, and the agent's contract is to push nothing rather than half —
 * a box that pushes nothing is flagged quiet, which is the other loud tell.
 *
 * Scoped to THIS box throughout: one box's push can never touch another's rows.
 */
export async function ingestBackupInventory(
  push: BackupInventoryPush,
): Promise<BackupIngestResult> {
  const seenAt = new Date();

  // Dedup on the natural key — a repeated (location, ref) in one payload would
  // upsert the same row twice — and sort deterministically, so two concurrent
  // pushes for the same box take row locks in the same order and cannot
  // deadlock. A later duplicate wins (Map keeps the last value for a key).
  const artifacts = Array.from(
    new Map(push.artifacts.map((a) => [`${a.location}:${a.ref}`, a])).values(),
  ).sort((a, b) => `${a.location}:${a.ref}`.localeCompare(`${b.location}:${b.ref}`));

  // The timeout is raised from Prisma's 5s default because this is a loop of
  // upserts, not a constant-time statement: at the contract's 2000-artifact cap
  // the default would abort a legitimate push from a long-lived repository, and
  // a rejected inventory reads on the page as a box that has gone quiet.
  const removed = await db.$transaction(
    async (tx) => {
      await tx.backupInventory.upsert({
        where: { box: push.box },
        create: {
          box: push.box,
          reportedAt: push.reportedAt,
          receivedAt: seenAt,
          artifactCount: artifacts.length,
        },
        update: {
          reportedAt: push.reportedAt,
          receivedAt: seenAt,
          artifactCount: artifacts.length,
        },
      });

      for (const a of artifacts) {
        const cols = columns(a, seenAt);
        await tx.backupArtifact.upsert({
          where: {
            box_location_ref: { box: push.box, location: LOCATION[a.location], ref: a.ref },
          },
          create: { box: push.box, location: LOCATION[a.location], ref: a.ref, ...cols },
          update: cols,
        });
      }

      // The sweep. `lt: seenAt` rather than `not: seenAt` so a row stamped by a
      // CONCURRENT later push survives — two overlapping pushes must not delete
      // each other's work.
      const { count } = await tx.backupArtifact.deleteMany({
        where: { box: push.box, lastSeenAt: { lt: seenAt } },
      });
      return count;
    },
    { timeout: 30_000 },
  );

  return { artifacts: artifacts.length, removed };
}
