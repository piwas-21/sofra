// The one query set behind "is this restaurant's data protected?".
//
// Extracted from `/admin/backups` when the scheduled alert sweep needed the same
// answer. Copying the four reads would have been three lines shorter and wrong:
// the page and the mail would then derive their verdicts from two independently
// maintained queries, and the failure mode is silent — the page shows a tenant
// red while the sweep, missing one `select`, computes it green and mails an
// all-clear. A monitoring surface that can disagree with its own alarm is worse
// than either alone.
//
// Everything decided here is a READ. The judgement lives in `backup-overview.ts`
// (pure) and the alarm in `backup-alert-policy.ts` (pure); this file only fetches.

import { db } from "@/lib/db";
import { loadTenantRegistry } from "@/lib/tenant-registry";
import { buildBackupOverview, type ArtifactFact, type BackupOverview } from "@/lib/backup-overview";
import { backupRetentionDays } from "@/lib/backup-retention";

/**
 * A ceiling on the artifact rows read at all.
 *
 * Ordered newest-first, so the truncation is honest where it matters: every
 * health verdict is derived from a tenant's NEWEST artifact, which survives the
 * cut. Only per-tenant counts and totals would truncate, and only on a platform
 * holding more than two thousand artifacts — against a measured inventory of
 * eleven. It exists so neither the page nor the sweep can become the thing that
 * out-of-memories the container the day retention is loosened on a box.
 *
 * The delete guard does NOT read this list (it counts in the database), so a
 * truncated read can never make a last copy look like one of many.
 */
export const MAX_ARTIFACT_ROWS = 2000;

type ArtifactRows = Awaited<ReturnType<typeof db.backupArtifact.findMany>>;

export type LoadedBackupOverview = {
  overview: BackupOverview;
  /** The rows the overview was built from, newest first — the page lists them. */
  artifacts: ArtifactRows;
  /** Passed through UNRESOLVED on purpose: an unreadable registry is a different
   *  thing to a page (render what is knowable) than to an alarm (refuse to judge),
   *  and this module must not decide that for either of them. */
  registry: Awaited<ReturnType<typeof loadTenantRegistry>>;
};

export async function loadBackupOverview(now: Date): Promise<LoadedBackupOverview> {
  const [registry, artifacts, boxReports, plans] = await Promise.all([
    loadTenantRegistry(),
    db.backupArtifact.findMany({ orderBy: { takenAt: "desc" }, take: MAX_ARTIFACT_ROWS }),
    db.backupInventory.findMany(),
    db.tenantBilling.findMany({
      select: { tenantSlug: true, trialEndsAt: true, subscriptions: { select: { status: true } } },
    }),
  ]);

  const overview = buildBackupOverview({
    registry: registry.ok
      ? registry.tenants.map((r) => ({
          slug: r.slug,
          name: r.name,
          status: r.status,
          box: r.box,
          // `managed:` rides along because the alarm AND the page need it: the box
          // skips `legacy` when it takes per-tenant dumps, so a legacy tenant with
          // no artifact is expected, not a gap — and the page says what covers it
          // instead rather than painting the absence red.
          managed: r.managed,
        }))
      : [],
    artifacts: artifacts as ArtifactFact[],
    plans: plans.map((p) => ({
      tenantSlug: p.tenantSlug,
      trialEndsAt: p.trialEndsAt,
      // "Paying" is derived from the same subscription rows /admin/billing
      // renders, so the two surfaces cannot disagree about whether a tenant is in
      // an archive window or simply a customer.
      paying: p.subscriptions.some((s) => s.status === "ACTIVE"),
    })),
    boxReports,
    now,
    retentionDays: backupRetentionDays(),
  });

  return { overview, artifacts, registry };
}
