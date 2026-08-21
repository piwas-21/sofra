// The job queue a box POLLS. (GET /api/backups/jobs, POST /api/backups/jobs/:id/result)
//
// Why a queue at all, rather than sofra just doing the thing: sofra cannot reach
// a box and must not be able to. Every credential in this feature points
// BOX -> SOFRA (ADR-012 invariant 2). SSH keys live on the founder's laptop and
// in Actions secrets, never in this public container, and the tempting
// alternative — a GitHub token to dispatch a backup workflow — is rejected
// because `Actions: write` cannot be narrowed to one workflow (workspace
// docs/runbooks/signup-to-live-tenant.md §0b), so the same token could dispatch
// `deprovision-tenant.yml --drop-db`. A backup feature must not ship a
// tenant-destruction primitive. So the founder's click writes a ROW, and the box
// comes and gets it. Latency is one poll (~5 min), which for a backup is nothing.

import { db } from "@/lib/db";
import {
  BackupJobAction,
  BackupJobStatus,
  BackupKind,
  BackupLocation,
} from "@/lib/generated/prisma/client";
import type { BackupArtifactInput, BackupJobResult } from "@/lib/backup-contract";
import { JOB_LEASE_MINUTES } from "@/lib/backup-job-policy";

/** A job as the box sees it. Deliberately minimal: an id, a verb, a slug and a
 *  ref. No reason, no requester, no plan data — the box needs none of it, and
 *  the founder's written justification for a deletion is not the box's business. */
export type WireJob = {
  id: string;
  action: "create" | "delete";
  tenantSlug: string;
  ref: string | null;
};

/** Most a single poll will carry. A box with a hundred queued jobs has a
 *  problem the queue should not make worse by handing it all of them at once. */
const CLAIM_BATCH = 25;

type ClaimedRow = { id: string; action: BackupJobAction; tenantSlug: string; ref: string | null };

/**
 * Hand this box its pending work, marking it claimed under a lease.
 *
 * Raw SQL, and it is the one place in this feature that needs it: the operation
 * is "select the claimable rows, lock them, flip them, and return them" as a
 * single statement, which Prisma's query API cannot express (no `updateMany`
 * that returns rows, no `SKIP LOCKED`). Doing it as read-then-update would let
 * two overlapping polls — the agent retrying, a founder curling the endpoint —
 * claim the same job and run the same dump twice.
 *
 * `FOR UPDATE SKIP LOCKED` is what makes concurrent polls safe: a row another
 * transaction is claiming is skipped rather than waited on.
 *
 * The lease re-offers a job whose box died mid-run (see JOB_LEASE_MINUTES).
 * `make_interval` takes the constant as a bound parameter rather than
 * interpolating it into the SQL text — there is no injection here (it is a TS
 * number), but a raw query that concatenates anything is a pattern that gets
 * copied to one that matters.
 */
export async function claimJobsForBox(box: string): Promise<WireJob[]> {
  const rows = await db.$queryRaw<ClaimedRow[]>`
    UPDATE "BackupJob"
       SET status = 'CLAIMED'::"BackupJobStatus", "claimedAt" = NOW(), "updatedAt" = NOW()
     WHERE id IN (
       SELECT id FROM "BackupJob"
        WHERE box = ${box}
          AND (
            status = 'PENDING'::"BackupJobStatus"
            OR (status = 'CLAIMED'::"BackupJobStatus"
                AND ("claimedAt" IS NULL
                     OR "claimedAt" < NOW() - make_interval(mins => ${JOB_LEASE_MINUTES})))
          )
        ORDER BY "createdAt" ASC
        LIMIT ${CLAIM_BATCH}
        FOR UPDATE SKIP LOCKED
     )
    RETURNING id, action, "tenantSlug", ref`;

  return rows.map((r) => ({
    id: r.id,
    action: r.action === BackupJobAction.DELETE ? "delete" : "create",
    tenantSlug: r.tenantSlug,
    ref: r.ref,
  }));
}

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

export type JobCompletion = "recorded" | "notFound";

/**
 * Record what the box says happened.
 *
 * Two things happen together or not at all: the job is closed, and — for a
 * successful `create` that handed one back — the new artifact is inserted. That
 * insert is why a founder who clicks "back up now" sees a result in seconds
 * instead of waiting for the next hourly inventory push.
 *
 * A successful `delete` removes the artifact row here too, rather than waiting
 * for the next push to sweep it. Scoped by (box, location, ref), the same
 * natural key the ingest uses.
 *
 * Idempotent: re-POSTing a result for a finished job overwrites the same values.
 * The box may retry a result it is unsure landed, and it must be able to.
 *
 * `mayComplete` is the caller's per-box authorization, applied AFTER the lookup
 * and reported as `notFound`: a box that does not own a job may not learn that it
 * exists. It lives here rather than in the route because the job's box is not
 * knowable until the row is read, and an authorization check that the caller could
 * forget to make is one that will eventually be forgotten.
 */
export async function completeJob(
  id: string,
  result: BackupJobResult,
  mayComplete: (job: { box: string }) => boolean = () => true,
): Promise<JobCompletion> {
  const job = await db.backupJob.findUnique({ where: { id } });
  if (!job) return "notFound";
  if (!mayComplete(job)) return "notFound";

  await db.$transaction(async (tx) => {
    await tx.backupJob.update({
      where: { id },
      data: {
        status: result.ok ? BackupJobStatus.DONE : BackupJobStatus.FAILED,
        finishedAt: new Date(),
        // Truncated by the schema (max 500) before it gets here. Cleared on a
        // success so a retried job does not keep an error from an earlier try.
        error: result.ok ? null : (result.error ?? "unspecified"),
      },
    });

    if (!result.ok) return;

    if (job.action === BackupJobAction.DELETE && job.ref) {
      await tx.backupArtifact.deleteMany({ where: { box: job.box, ref: job.ref } });
      return;
    }

    const a = result.artifact;
    if (!a) return;
    const cols = {
      tenantSlug: a.tenantSlug,
      kind: KIND[a.kind],
      takenAt: a.takenAt,
      sizeBytes: BigInt(a.sizeBytes),
      sha256: a.sha256 ?? null,
      lastSeenAt: new Date(),
    };
    await tx.backupArtifact.upsert({
      where: { box_location_ref: { box: job.box, location: LOCATION[a.location], ref: a.ref } },
      create: { box: job.box, location: LOCATION[a.location], ref: a.ref, ...cols },
      update: cols,
    });
  });

  return "recorded";
}

/** Outstanding work for a box — the number backupCreateVerdict caps. */
export function countPendingForBox(box: string): Promise<number> {
  return db.backupJob.count({
    where: { box, status: { in: [BackupJobStatus.PENDING, BackupJobStatus.CLAIMED] } },
  });
}
