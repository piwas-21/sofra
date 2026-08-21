import { getTranslations } from "next-intl/server";
import { requireAdmin } from "@/lib/rbac";
import { controlLocale } from "@/lib/control-locale";
import { db } from "@/lib/db";
import { loadBackupOverview } from "@/lib/backup-overview-load";
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

export default async function AdminBackupsPage() {
  await requireAdmin();
  const locale = await controlLocale();
  const t = await getTranslations({ locale, namespace: "control.admin.backups" });

  // The four reads and the join live in `backup-overview-load.ts` because the
  // scheduled alert sweep asks the same question, and two copies of that query
  // would eventually disagree — this page rendering a tenant red while the mail
  // computed it green. An unreadable registry does NOT blank this page, unlike
  // /admin/fleet's: half of what matters here is knowable without it, and a
  // backup page that goes blank on an ops fault is one nobody trusts. (The
  // ALARM makes the opposite choice and refuses to judge — see the sweep.)
  const [{ overview, artifacts, registry }, jobs] = await Promise.all([
    loadBackupOverview(new Date()),
    db.backupJob.findMany({
      take: 20,
      orderBy: { createdAt: "desc" },
      include: { requestedBy: { select: { name: true } } },
    }),
  ]);

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
