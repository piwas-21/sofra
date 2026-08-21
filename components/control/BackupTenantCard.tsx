import { humanBytes, shortDate } from "@/lib/format";
import { hoursSince } from "@/lib/backup-health";
import type { BackupTenantRow } from "@/lib/backup-overview";
import BackupRequestForm from "./BackupRequestForm";
import BackupDeleteForm from "./BackupDeleteForm";

// One tenant's backup posture. A server component: it renders facts the page
// already computed (lib/backup-overview.ts) and decides nothing itself — the two
// forms it embeds are the only client code here.

type Translator = (key: string, values?: Record<string, string | number>) => string;

export type ArtifactRow = {
  id: string;
  ref: string;
  kind: string;
  location: string;
  takenAt: Date;
  sizeBytes: bigint;
};

/** Red for the two states that mean data is at risk, amber for one missed
 *  nightly, muted-green for fine. Deliberately only two alarm colours: if
 *  everything worrying were red, red would stop meaning anything. */
function healthTone(health: BackupTenantRow["health"]): string {
  if (health === "protected") return "text-craft-success-text dark:text-craft-success";
  if (health === "stale") return "text-craft-warning-text dark:text-craft-warning";
  return "text-craft-error-text dark:text-craft-error";
}

/**
 * The badge, for a tenant that is never dumped on its own (`managed: legacy`,
 * ADR-006). Muted, not red and not green: it is not a verdict on this tenant's
 * per-tenant copies, it is the statement that there are none to judge and what
 * covers it instead. Red here is exactly the row ADR-014 D5 removed from the
 * ALARM for being unactionable — leaving it on the page only moved the false
 * alarm somewhere quieter.
 */
function healthLabel(row: BackupTenantRow, t: Translator): { text: string; tone: string } {
  if (row.clusterDumpOnly) return { text: t("health.clusterDump"), tone: "text-muted-foreground" };
  return { text: t(`health.${row.health}`), tone: healthTone(row.health) };
}

function RetentionLine({ row, t }: Readonly<{ row: BackupTenantRow; t: Translator }>) {
  const r = row.retention;
  if (r.kind === "notApplicable") return null;
  // A cluster-dump-only tenant has no per-tenant artifact, so the only retention
  // verdict it can ever reach is `nothingHeld` — whose sentence ends "there is
  // nothing to restore", which is FALSE for it: its database is in the
  // whole-cluster dump and shipped off box nightly. The row already says what
  // covers it; a retention window over copies that are not the ones holding this
  // tenant's data would be the same wrong answer in gentler type.
  if (row.clusterDumpOnly) return null;
  const reason = t(`retention.reason.${r.reason}`);

  // The sentence the whole feature exists for: what a returning restaurant is
  // told. Never rendered for a tenant we hold nothing for — "we have nothing"
  // must not be dressed up as a retention window.
  if (r.kind === "nothingHeld") {
    return (
      <p className="mt-2 font-label text-sm text-craft-error-text">
        {t("retention.nothingHeld", { reason })}
      </p>
    );
  }
  if (r.kind === "expired") {
    return (
      <p className="mt-2 font-label text-sm text-muted-foreground">
        {t("retention.expired", { reason, until: shortDate(r.until) })}
      </p>
    );
  }
  return (
    <p className="mt-2 font-label text-sm">
      {t("retention.retained", { reason, until: shortDate(r.until), days: r.daysLeft })}
    </p>
  );
}

function ArtifactLine({
  artifact,
  tenantSlug,
  isLastCopy,
  deleteEnabled,
  t,
}: Readonly<{
  artifact: ArtifactRow;
  tenantSlug: string;
  isLastCopy: boolean;
  deleteEnabled: boolean;
  t: Translator;
}>) {
  return (
    <li className="border-t border-border pt-2 first:border-t-0 first:pt-0" data-ref={artifact.ref}>
      <span className="font-label text-sm">
        {t(`artifact.kind.${artifact.kind}`)} · {t(`artifact.location.${artifact.location}`)} ·{" "}
        {humanBytes(Number(artifact.sizeBytes))} · {shortDate(artifact.takenAt)}
      </span>
      {/* The ref is an opaque identifier, not a path: a restic snapshot id or a
          dump filename. It is here because it is what an operator pastes into
          `restic restore` — and it is behind requireAdmin, like the rest. */}
      <span className="ml-2 font-label text-sm text-muted-foreground break-all">{artifact.ref}</span>
      {deleteEnabled && (
        <BackupDeleteForm
          artifactId={artifact.id}
          tenantSlug={tenantSlug}
          isLastCopy={isLastCopy}
        />
      )}
    </li>
  );
}

export default function BackupTenantCard({
  row,
  artifacts,
  deleteEnabled,
  now,
  t,
}: Readonly<{
  row: BackupTenantRow;
  artifacts: ArtifactRow[];
  deleteEnabled: boolean;
  now: number;
  t: Translator;
}>) {
  const age = row.newestTakenAt ? hoursSince(row.newestTakenAt, new Date(now)) : null;
  const health = healthLabel(row, t);

  return (
    <li
      className="hand-drawn-border bg-card p-5"
      data-slug={row.slug}
      data-health={row.health}
      data-cluster-dump-only={row.clusterDumpOnly ? "true" : undefined}
    >
      <div className="flex flex-wrap items-baseline justify-between gap-3">
        <span>
          <span className="font-hand text-2xl font-bold">{row.slug}</span>
          <span className={`ml-3 font-label text-sm font-bold ${health.tone}`}>{health.text}</span>
          <span className="block font-label text-sm text-muted-foreground">
            {row.name ?? t("tenant.notInRegistry")}
            {row.box ? ` · ${t("tenant.box", { box: row.box })}` : ""}
          </span>
        </span>
        <span className="font-label text-sm text-right text-muted-foreground">
          <span className="block">
            {t("tenant.artifacts", { count: row.artifactCount })} ·{" "}
            {humanBytes(row.bytes)}
          </span>
          <span className="block">
            {age === null
              ? t("tenant.newestNever")
              : t("tenant.newest", { hours: age })}
          </span>
        </span>
      </div>

      {/* What actually covers a tenant the box never dumps on its own, said where
          the health badge would otherwise have shouted. Without it the row reads
          as an unexplained blank: no artifacts, no age, no reason. */}
      {row.clusterDumpOnly && (
        <p className="mt-2 font-label text-sm text-muted-foreground">
          {t("tenant.clusterDumpOnly")}
        </p>
      )}
      {/* When the box is quiet, every age above is a memory of that box rather
          than an observation, and saying so is more honest than a green badge. */}
      {row.boxQuiet && (
        <p role="alert" className="mt-2 font-label text-sm text-craft-warning-text">
          {t("tenant.boxQuiet", { box: row.box ?? "—" })}
        </p>
      )}

      <RetentionLine row={row} t={t} />

      {artifacts.length > 0 && (
        <ul className="mt-3 grid gap-2">
          {artifacts.map((a) => (
            <ArtifactLine
              key={a.id}
              artifact={a}
              tenantSlug={row.slug}
              isLastCopy={row.artifactCount <= 1}
              deleteEnabled={deleteEnabled}
              t={t}
            />
          ))}
        </ul>
      )}

      {/* Under the list, because it is a caveat ABOUT the list and not a verdict
          on the tenant. It used to be a red alert reading "every copy sits on the
          box that runs this tenant" — which is not what the flag knows. The agent
          hard-codes `location: "local"` for everything it finds on the box
          filesystem and cannot see a restic snapshot at all, while
          `backup-offsite.sh` ships that whole directory off box every night. So
          the flag is true for every tenant, permanently, and the off-box copies
          it denies demonstrably exist. Stated as the reporting gap it is until
          the agent enumerates restic (ADR-014 D5, follow-up B-b) — a red alarm
          that is always on is a page training its reader to skip red. */}
      {row.singleSiteOnly && (
        <p className="mt-3 font-label text-sm text-muted-foreground">
          {t("tenant.offBoxNotReported")}
        </p>
      )}

      {/* Only offered for a tenant that still has a registry entry: there is no
          box to ask for a backup of a tenant that no longer exists. And not for a
          cluster-dump-only one either — `backup-tenant.sh` REFUSES anything that
          is not `managed: scripts` (ADR-006 protects tenant 1), so the button
          would queue a job whose only possible outcome is a red FAILED row saying
          so five minutes later. */}
      {row.registryStatus !== null && !row.clusterDumpOnly && (
        <div className="mt-3">
          <BackupRequestForm tenantSlug={row.slug} />
        </div>
      )}
    </li>
  );
}
