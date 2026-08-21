// The box ⇄ control-plane backup wire contract, as pure schema.
//
// WHY THE SCHEMAS LIVE APART FROM THE INGEST that uses them: this file imports
// nothing but zod, so it is measurable by the unit coverage floor. The half that
// is easy to get wrong — what a box is allowed to say about a tenant's data — is
// therefore tested, while the half that talks to Postgres stays an E2E target
// (lib/backup-inventory.ts, same split as vies/vies-result and fleet's).
//
// CREDENTIAL DIRECTION, and it is the whole security design of this feature:
// **every credential points BOX → SOFRA. The control plane never holds a
// credential that can reach a box.** That is ADR-012 invariant 2 — a compromised
// public sofra container may propose work, never perform it — and it is why the
// obvious shortcut is rejected. Handing sofra a GitHub `Actions: write` token to
// dispatch a backup workflow would work, but `Actions: write` CANNOT be narrowed
// to a single workflow (workspace docs/runbooks/signup-to-live-tenant.md §0b), so
// the same token could dispatch `deprovision-tenant.yml --drop-db`. A backup
// feature must not ship a tenant-destruction primitive as a side effect of being
// able to take a backup.
//
// So the box PUSHES its inventory and PULLS its jobs, and the latency of the
// whole feature is "next poll" (~5 minutes). That is accepted: a backup is not
// interactive, and no owner action here is one where five minutes matters.
//
// PII: an inventory is METADATA, never contents. Nothing in these schemas can
// carry a row of a restaurant's data — only slugs, sizes, timestamps, a snapshot
// ref and a checksum. That is still customer-identifying (which restaurants we
// hold data for, and how much), so every surface that renders it is admin-only.

import { z } from "zod";

/** Registry slug grammar, matched to lib/validation-provision.ts's. */
const slug = z
  .string()
  .trim()
  .min(1)
  .max(80)
  .regex(/^[a-z0-9][a-z0-9-]*$/, "tenantSlug must be a lowercase registry slug");

/**
 * Why an artifact was taken. Lowercase on the wire, uppercase in the database
 * (Prisma enum), and the mapping is this list — there is no second copy.
 *
 * `deprovision` is the load-bearing one for the owner's actual question. It is
 * the dump taken as a tenant is torn down, i.e. the ONLY copy of a departed
 * restaurant's menu, and the one whose deletion is irreversible in the way that
 * matters.
 */
export const BACKUP_KINDS = ["scheduled", "manual", "deprovision", "archive"] as const;
export type BackupKindWire = (typeof BACKUP_KINDS)[number];

/**
 * Where the artifact physically is.
 *
 * `local` = a dump file on the box that produced it. `restic` = a snapshot in an
 * encrypted repository that has been shipped cross-box. They are not equivalent
 * and the page must not add them up as if they were: a tenant whose only copy is
 * `local` on the box that also runs it has no backup at all in the sense that
 * matters, because the failure that takes the box takes the copy with it.
 */
export const BACKUP_LOCATIONS = ["restic", "local"] as const;
export type BackupLocationWire = (typeof BACKUP_LOCATIONS)[number];

/** A single artifact as the box reports it. */
export const backupArtifactSchema = z.object({
  tenantSlug: slug,
  kind: z.enum(BACKUP_KINDS),
  takenAt: z.coerce.date(),
  // A JSON number, so the cap is well under 2^53. One terabyte is four orders of
  // magnitude above the largest tenant dump measured (18 MiB for the whole
  // staging repository) — wide enough never to refuse a real artifact, narrow
  // enough that a garbled value is rejected instead of rendered as "8 PB".
  sizeBytes: z.number().int().min(0).max(1_000_000_000_000),
  location: z.enum(BACKUP_LOCATIONS),
  // A restic snapshot id or a filename. Bounded because it is stored and shown.
  ref: z.string().trim().min(1).max(300),
  // Optional: restic already checksums its own contents, so this is only present
  // for plain local dumps, where nothing else would notice a truncated file.
  sha256: z
    .string()
    .trim()
    .regex(/^[0-9a-f]{64}$/, "sha256 must be 64 lowercase hex characters")
    .nullish(),
});

/**
 * A whole box's inventory. WHOLE is the contract, and it decides the ingest's
 * prune semantics: an artifact this box does not list has ceased to exist, and
 * its row goes.
 *
 * The consequence, stated so nobody has to discover it: an agent that reports a
 * PARTIAL inventory (its restic listing failed, its local listing succeeded)
 * makes the missing half look destroyed, and the page will shout UNPROTECTED. So
 * the agent must push nothing at all rather than push half — and a box that
 * pushes nothing is flagged quiet, which is the tell. Both failure modes are
 * loud, and that is the point: the alternative — keeping rows a box no longer
 * reports — would make a genuinely emptied repository invisible, which is the
 * one thing a backup page must never do.
 */
export const backupInventorySchema = z.object({
  box: z.string().trim().min(1).max(40),
  reportedAt: z.coerce.date(),
  // A cap, not a policy: 2000 artifacts is more than five years of nightlies for
  // a hundred tenants, against a measured inventory of 11. It exists so a
  // runaway agent cannot turn one POST into a memory event — and it is the
  // number lib/backup-inventory.ts sizes its transaction timeout against.
  artifacts: z.array(backupArtifactSchema).max(2000),
});

export type BackupInventoryPush = z.infer<typeof backupInventorySchema>;
export type BackupArtifactInput = z.infer<typeof backupArtifactSchema>;

/** The result a box reports for a job it ran. */
export const backupJobResultSchema = z.object({
  ok: z.boolean(),
  // Free text from the box, bounded and never echoed to the box that sent it.
  // Rendered to the founder only, who needs the reason a backup did not happen.
  error: z.string().trim().max(500).nullish(),
  // A `create` that succeeded hands back the artifact it produced, so the founder
  // sees the new backup without waiting for the next inventory push.
  artifact: backupArtifactSchema.nullish(),
});

export type BackupJobResult = z.infer<typeof backupJobResultSchema>;

/** `?box=` on the job poll. Validated for the same reason the body is. */
export const backupBoxQuerySchema = z.string().trim().min(1).max(40);
