// What the founder is allowed to ask a box to do — and, mostly, what he is not.
//
// ════════════════════════════════════════════════════════════════════════════
// WHY `delete` SHIPS DISABLED, AND RETENTION DOES THE DELETING
// ════════════════════════════════════════════════════════════════════════════
// `create` is safe: the worst outcome is a duplicate copy of data we already
// hold. `delete` destroys the only copy of a departed customer's data, and there
// is no undo anywhere in the system — no trash, no soft delete, no second site,
// because the artifact IS the second site. Four things decided it:
//
//  1. **A backup exists to survive mistakes, including ours.** A delete button in
//     the control plane converts every other class of bug in this app — a stolen
//     session, a mis-wired form, a confused 2 a.m. click on the wrong row — into
//     permanent, unrecoverable customer data loss. That is a strictly larger
//     blast radius than the problem it solves.
//  2. **Retention already deletes, and deletes better.** `restic forget --prune`
//     runs on the box under a policy committed in the deploy repo: declarative,
//     reviewable in a PR, uniform across tenants, and impossible to fire by
//     accident. lib/backup-retention.ts states the same window to the founder. A
//     button is a worse version of a mechanism we already have.
//  3. **We cannot verify it.** The credential direction is BOX → SOFRA (ADR-012
//     invariant 2); sofra cannot inspect a box. After a delete, all this app can
//     record is that the box SAID it deleted something. An unverifiable
//     destructive primitive in the least-trusted component is the same class of
//     mistake as giving the public container `Actions: write`.
//  4. **It does not serve the owner's actual need.** The ask was "keep a trial
//     tenant's data in case they come back". That is served by retaining and by
//     SEEING — not by a delete control.
//
// So: the WIRE CONTRACT keeps `delete` (the box agent is built against it and a
// contract is not changed unilaterally), the code path is implemented and
// tested — and it is **off unless `BACKUP_DELETE_ENABLED=true`**, which is a box
// `.env` edit plus a container restart. That is deliberate friction of exactly
// the right shape: destroying a customer's last copy should take a deployment,
// not a click. Even switched on, it is refused for the LAST artifact of a tenant
// without an explicit override, requires the slug to be typed, and requires a
// written reason that lands in the audit log.

/** How long a claimed job may sit before it is offered to a box again.
 *
 *  The agent polls every 5 minutes, so fifteen is three missed polls: long
 *  enough that a running dump is never handed to a second poller, short enough
 *  that an agent killed mid-job does not strand the founder's request forever
 *  with nothing on the page but "queued". Re-offering is safe for `create`
 *  (a duplicate artifact) and idempotent for `delete` (a ref already gone). */
export const JOB_LEASE_MINUTES = 15;

/** A cap on outstanding work per box. Not throttling — a runaway loop in a form
 *  or a bored click on "back up now" must not be able to queue a thousand dumps
 *  against a production database that also serves a restaurant's lunch. */
export const MAX_PENDING_JOBS_PER_BOX = 20;

export type JobLeaseFacts = { status: string; claimedAt: Date | null };

/** Should this job be handed to a polling box? */
export function jobIsClaimable(facts: JobLeaseFacts, now: Date): boolean {
  if (facts.status === "PENDING") return true;
  if (facts.status !== "CLAIMED") return false;
  if (!facts.claimedAt) return true; // CLAIMED with no timestamp: treat as expired.
  return now.getTime() - facts.claimedAt.getTime() >= JOB_LEASE_MINUTES * 60 * 1000;
}

/** Is the destructive path switched on for this environment at all? */
export function backupDeleteEnabled(): boolean {
  return process.env.BACKUP_DELETE_ENABLED === "true";
}

/** Every refusal is a `control.errors.backup.*` message key. */
export type BackupDeleteRefusal =
  /** The environment has not enabled deletion. The default, everywhere. */
  | "deleteDisabled"
  /** The typed slug did not match the artifact's tenant. */
  | "confirmSlugMismatch"
  /** No reason given. A destructive act with no recorded why is unauditable. */
  | "reasonRequired"
  /** It is the only artifact this tenant has, and no override was given. */
  | "lastArtifact"
  /** The ref names nothing we hold. */
  | "artifactNotFound";

export type BackupDeleteVerdict = { ok: true } | { ok: false; reason: BackupDeleteRefusal };

export type BackupDeleteRequest = {
  enabled: boolean;
  /** Null when the ref matched no artifact row. */
  artifact: { tenantSlug: string } | null;
  /** How many artifacts this tenant has in total, including this one. */
  tenantArtifactCount: number;
  typedSlug: string;
  reason: string;
  /** The founder explicitly accepted destroying the tenant's last copy. */
  override: boolean;
};

/** The minimum a reason has to be before it counts as one. Short enough not to
 *  be busywork, long enough that "x" and "." do not satisfy the audit trail. */
const MIN_REASON_LENGTH = 8;

/**
 * May this artifact be deleted?
 *
 * Order matters and is defensive: the environment gate first (so a disabled
 * deployment never even reveals whether a ref exists), then the typed slug, then
 * the reason, and only then the last-copy rule — which is the one that needs the
 * founder to have looked at what he is doing.
 */
export function backupDeleteVerdict(req: BackupDeleteRequest): BackupDeleteVerdict {
  if (!req.enabled) return { ok: false, reason: "deleteDisabled" };
  if (!req.artifact) return { ok: false, reason: "artifactNotFound" };
  // Case-sensitive: registry slugs are lowercase by grammar, so a mismatch here
  // means a different tenant was typed — precisely the case worth stopping.
  if (req.typedSlug.trim() !== req.artifact.tenantSlug) {
    return { ok: false, reason: "confirmSlugMismatch" };
  }
  if (req.reason.trim().length < MIN_REASON_LENGTH) return { ok: false, reason: "reasonRequired" };
  // The last copy. `<= 1` rather than `=== 1` so a miscounted zero refuses too:
  // if the count is wrong, the safe direction is to refuse.
  if (req.tenantArtifactCount <= 1 && !req.override) {
    return { ok: false, reason: "lastArtifact" };
  }
  return { ok: true };
}

export type BackupCreateRefusal =
  /** This box already has as much queued work as it is allowed. */
  | "tooManyPending"
  /** The slug is not a tenant this control plane knows about. */
  | "unknownTenant";

export type BackupCreateVerdict = { ok: true } | { ok: false; reason: BackupCreateRefusal };

/**
 * May a backup be REQUESTED for this tenant?
 *
 * Almost nothing refuses, and that asymmetry with delete is the point: taking an
 * extra copy of data we already hold cannot lose anything. The only two refusals
 * protect the box, not the data.
 */
export function backupCreateVerdict(req: {
  knownTenant: boolean;
  pendingForBox: number;
}): BackupCreateVerdict {
  if (!req.knownTenant) return { ok: false, reason: "unknownTenant" };
  if (req.pendingForBox >= MAX_PENDING_JOBS_PER_BOX) return { ok: false, reason: "tooManyPending" };
  return { ok: true };
}
