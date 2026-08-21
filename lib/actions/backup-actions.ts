"use server";

// The founder's two buttons on /admin/backups. Both write a ROW; neither
// touches a box. The box polls (lib/backup-jobs.ts) — sofra holds no credential
// that can reach one, and that is ADR-012 invariant 2, not an implementation
// detail waiting to be optimised away.

import { revalidatePath } from "next/cache";
import { requireAdmin } from "@/lib/rbac";
import { db } from "@/lib/db";
import { audit } from "@/lib/audit";
import { loadTenantRegistry } from "@/lib/tenant-registry";
import { BackupJobAction } from "@/lib/generated/prisma/client";
import {
  backupCreateVerdict,
  backupDeleteEnabled,
  backupDeleteVerdict,
} from "@/lib/backup-job-policy";
import { countPendingForBox } from "@/lib/backup-jobs";

export type BackupActionState = { error?: string; ok?: boolean; queuedSlug?: string };

/** FormData entries are `string | File`, and `String(File)` is "[object File]".
 *  Every sibling action reads them this way; a File fails closed here (it
 *  matches no slug and no id). */
function field(form: FormData, name: string): string {
  const raw = form.get(name);
  return typeof raw === "string" ? raw.trim() : "";
}

/**
 * Ask a box to take a backup now.
 *
 * Almost nothing refuses, and the asymmetry with the delete below is the whole
 * safety design: an extra copy of data we already hold cannot lose anything, so
 * this is one click. The two refusals protect the BOX (a runaway request loop
 * must not queue a thousand dumps against a database that is also serving
 * lunch), never the data.
 */
export async function requestBackupAction(
  _prev: BackupActionState,
  formData: FormData,
): Promise<BackupActionState> {
  const admin = await requireAdmin();
  const slug = field(formData, "tenantSlug");

  // The box comes from the REGISTRY, never from the form. A box id posted by the
  // client would let a request be aimed at a box the tenant does not live on —
  // which that box would rightly refuse, but the refusal would arrive five
  // minutes later as a failed job instead of instantly as a validation error.
  const registry = await loadTenantRegistry();
  if (!registry.ok) return { error: "backup.registryUnavailable" };
  const tenant = registry.tenants.find((t) => t.slug === slug);

  const verdict = backupCreateVerdict({
    knownTenant: Boolean(tenant),
    pendingForBox: tenant ? await countPendingForBox(tenant.box) : 0,
  });
  if (!verdict.ok) return { error: `backup.${verdict.reason}` };
  if (!tenant) return { error: "backup.unknownTenant" }; // narrows for TypeScript

  const job = await db.backupJob.create({
    data: {
      box: tenant.box,
      action: BackupJobAction.CREATE,
      tenantSlug: tenant.slug,
      requestedById: admin.id,
    },
  });
  await audit(admin.id, "backup.job.requested", "BackupJob", job.id, {
    tenantSlug: tenant.slug,
    box: tenant.box,
    action: "create",
  });

  revalidatePath("/admin/backups");
  return { ok: true, queuedSlug: tenant.slug };
}

/**
 * Ask a box to destroy an artifact.
 *
 * Read lib/backup-job-policy.ts before changing anything here: `delete` is OFF
 * unless `BACKUP_DELETE_ENABLED=true`, because retention on the box already
 * deletes — declaratively, reviewably, and without a button that turns any other
 * bug in this app into permanent customer data loss. Everything below is the
 * guard for the environments that switch it on anyway.
 *
 * Four gates, and the server re-checks every one of them regardless of what the
 * form offered: the env flag, the typed slug, a written reason, and a refusal to
 * destroy a tenant's LAST copy without an explicit override.
 */
export async function requestArtifactDeletionAction(
  _prev: BackupActionState,
  formData: FormData,
): Promise<BackupActionState> {
  const admin = await requireAdmin();
  const artifactId = field(formData, "artifactId");
  const enabled = backupDeleteEnabled();

  // Looked up BEFORE the verdict so the verdict can count the tenant's copies,
  // and `null` when the flag is off — a disabled deployment must not become an
  // oracle for whether a given artifact id exists.
  const artifact = enabled
    ? await db.backupArtifact.findUnique({ where: { id: artifactId } })
    : null;
  const tenantArtifactCount = artifact
    ? await db.backupArtifact.count({ where: { tenantSlug: artifact.tenantSlug } })
    : 0;

  const reason = field(formData, "reason");
  const verdict = backupDeleteVerdict({
    enabled,
    artifact,
    tenantArtifactCount,
    typedSlug: field(formData, "confirmSlug"),
    reason,
    override: formData.get("override") === "on",
  });
  if (!verdict.ok) return { error: `backup.${verdict.reason}` };
  if (!artifact) return { error: "backup.artifactNotFound" }; // narrows for TypeScript

  const job = await db.backupJob.create({
    data: {
      box: artifact.box,
      action: BackupJobAction.DELETE,
      tenantSlug: artifact.tenantSlug,
      ref: artifact.ref,
      reason,
      override: tenantArtifactCount <= 1,
      requestedById: admin.id,
    },
  });
  // The reason is recorded verbatim. Six months from now "why is this gone?" has
  // to be answerable from the log, and `lastCopy` is stored as a fact rather than
  // re-derived later, when the count will have changed.
  await audit(admin.id, "backup.artifact.deleteRequested", "BackupJob", job.id, {
    tenantSlug: artifact.tenantSlug,
    box: artifact.box,
    ref: artifact.ref,
    reason,
    lastCopy: tenantArtifactCount <= 1,
  });

  revalidatePath("/admin/backups");
  return { ok: true, queuedSlug: artifact.tenantSlug };
}
