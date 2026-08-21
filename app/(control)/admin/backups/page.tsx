import { getTranslations } from "next-intl/server";
import { requireAdmin } from "@/lib/rbac";
import { controlLocale } from "@/lib/control-locale";
import { db } from "@/lib/db";
import { loadTenantRegistry } from "@/lib/tenant-registry";
import { buildBackupOverview, type ArtifactFact } from "@/lib/backup-overview";
import { backupRetentionDays } from "@/lib/backup-retention";
import { backupDeleteEnabled } from "@/lib/backup-job-policy";
import { STALE_AFTER_HOURS, UNPROTECTED_AFTER_HOURS } from "@/lib/backup-health";
import BackupTenantCard, { type ArtifactRow } from "@/components/control/BackupTenantCard";
import BackupBoxStatus from "@/components/control/BackupBoxStatus";
import BackupJobsList, { type JobRow } from "@/components/control/BackupJobsList";

// The owner's window onto backups that already exist. Nothing here takes one —
// both boxes have dumped nightly at 02:15 and shipped cross-box into encrypted
// restic repositories at 03:00 since long before this page. What was missing was
// any way to see it, and therefore any way to NOTICE A TENANT THAT HAD FALLEN
// OUT OF IT. That is what this page is for; the listing of successes is scenery.
//
// The registry changes underneath us (rsync on deploy-repo push) — always
// re-read, same as /admin/tenants and /admin/fleet.
export const dynamic = "force-dynamic";

/** How many artifacts to show per tenant. The page answers "is this protected",
 *  not "list every snapshot" — the newest few carry the whole answer, and the
 *  box is the place to enumerate a repository. */
const ARTIFACTS_PER_TENANT = 5;

/**
 * A ceiling on the rows this page reads at all.
 *
 * Ordered newest-first, so the truncation is honest where it matters: the health
 * verdict for every tenant is derived from its NEWEST artifact, which survives
 * the cut. Only the per-tenant counts and totals would truncate, and only on a
 * platform holding more than two thousand artifacts — against a measured
 * inventory of eleven. It exists so this page cannot become the thing that
 * out-of-memories the container the day retention is loosened on a box.
 *
 * The delete guard does NOT read this list (it counts in the database), so a
 * truncated page can never make a last copy look like one of many.
 */
const MAX_ARTIFACT_ROWS = 2000;

export default async function AdminBackupsPage() {
  await requireAdmin();
  const locale = await controlLocale();
  const t = await getTranslations({ locale, namespace: "control.admin.backups" });

  const [registry, artifacts, boxReports, plans, jobs] = await Promise.all([
    loadTenantRegistry(),
    db.backupArtifact.findMany({ orderBy: { takenAt: "desc" }, take: MAX_ARTIFACT_ROWS }),
    db.backupInventory.findMany(),
    db.tenantBilling.findMany({
      select: { tenantSlug: true, trialEndsAt: true, subscriptions: { select: { status: true } } },
    }),
    db.backupJob.findMany({
      take: 20,
      orderBy: { createdAt: "desc" },
      include: { requestedBy: { select: { name: true } } },
    }),
  ]);

  // An unreadable registry does NOT blank this page, unlike /admin/fleet's.
  // Half of what matters here is knowable without it: the artifacts we hold, the
  // boxes still reporting, and every departed tenant's retention date — which is
  // exactly the tenant that has no registry entry anyway. Failing closed would
  // hide the data at the moment the mount broke, and a backup page that goes
  // blank on an ops fault is a backup page nobody trusts.
  const registryTenants = registry.ok
    ? registry.tenants.map((r) => ({ slug: r.slug, name: r.name, status: r.status, box: r.box }))
    : [];

  const overview = buildBackupOverview({
    registry: registryTenants,
    artifacts: artifacts as ArtifactFact[],
    plans: plans.map((p) => ({
      tenantSlug: p.tenantSlug,
      trialEndsAt: p.trialEndsAt,
      // "Paying" is derived from the same subscription rows /admin/billing
      // renders, so the two surfaces cannot disagree about whether a tenant is
      // in an archive window or simply a customer.
      paying: p.subscriptions.some((s) => s.status === "ACTIVE"),
    })),
    boxReports,
    now: new Date(),
    retentionDays: backupRetentionDays(),
  });

  const bySlug = new Map<string, ArtifactRow[]>();
  for (const a of artifacts) {
    const list = bySlug.get(a.tenantSlug) ?? [];
    if (list.length < ARTIFACTS_PER_TENANT) list.push(a);
    bySlug.set(a.tenantSlug, list);
  }

  const now = Date.now();
  const deleteEnabled = backupDeleteEnabled();

  return (
    <div className="grid gap-10">
      <div>
        <h1 className="font-display font-bold text-5xl">{t("title")}</h1>
        <p className="mt-2 font-label text-muted-foreground">{t("intro")}</p>
        <p className="mt-1 font-label text-sm text-muted-foreground">
          {t("thresholds", {
            stale: STALE_AFTER_HOURS,
            unprotected: UNPROTECTED_AFTER_HOURS,
            days: backupRetentionDays(),
          })}
        </p>
      </div>

      {/* The headline, and the reason the page exists: how many tenants are NOT
          covered right now. Stated before anything is listed, because a count you
          have to assemble by scrolling is a count nobody assembles. */}
      {overview.attention > 0 ? (
        <p role="alert" className="hand-drawn-border bg-card p-4 font-label text-craft-error-text">
          {t("attention", { count: overview.attention, total: overview.rows.length })}
        </p>
      ) : (
        <p className="hand-drawn-border bg-card p-4 font-label text-craft-success-text">
          {t("allProtected", { count: overview.rows.length })}
        </p>
      )}

      {!registry.ok && (
        <p role="alert" className="hand-drawn-border bg-card p-4 font-label text-craft-warning-text">
          {t("registryUnavailable", { error: registry.error })}
        </p>
      )}

      <section>
        <h2 className="font-hand text-3xl font-bold">{t("boxes.title")}</h2>
        <div className="mt-4">
          <BackupBoxStatus boxes={overview.boxes} now={now} t={t} />
        </div>
      </section>

      <section>
        <h2 className="font-hand text-3xl font-bold">
          {t("tenants", { count: overview.rows.length })}
        </h2>
        <ul className="mt-4 grid gap-4">
          {overview.rows.map((row) => (
            <BackupTenantCard
              key={row.slug}
              row={row}
              artifacts={bySlug.get(row.slug) ?? []}
              deleteEnabled={deleteEnabled}
              now={now}
              t={t}
            />
          ))}
          {overview.rows.length === 0 && (
            <li className="font-label text-muted-foreground">{t("empty")}</li>
          )}
        </ul>
      </section>

      <section>
        <h2 className="font-hand text-3xl font-bold">{t("jobs.title")}</h2>
        <p className="mt-1 font-label text-sm text-muted-foreground">
          {deleteEnabled ? t("jobs.deleteEnabled") : t("jobs.deleteDisabled")}
        </p>
        <div className="mt-4">
          <BackupJobsList jobs={jobs as JobRow[]} t={t} />
        </div>
      </section>
    </div>
  );
}
