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

function RetentionLine({ row, t }: Readonly<{ row: BackupTenantRow; t: Translator }>) {
  const r = row.retention;
  if (r.kind === "notApplicable") return null;
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

  return (
    <li className="hand-drawn-border bg-card p-5" data-slug={row.slug} data-health={row.health}>
      <div className="flex flex-wrap items-baseline justify-between gap-3">
        <span>
          <span className="font-hand text-2xl font-bold">{row.slug}</span>
          <span className={`ml-3 font-label text-sm font-bold ${healthTone(row.health)}`}>
            {t(`health.${row.health}`)}
          </span>
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

      {/* Fresh, green by every age rule, and gone with the box it sits on. Called
          out separately because it is a different kind of unprotected and the two
          are easy to conflate. */}
      {row.singleSiteOnly && (
        <p role="alert" className="mt-2 font-label text-sm text-craft-error-text">
          {t("tenant.localOnly")}
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

      {/* Only offered for a tenant that still has a registry entry: there is no
          box to ask for a backup of a tenant that no longer exists. */}
      {row.registryStatus !== null && (
        <div className="mt-3">
          <BackupRequestForm tenantSlug={row.slug} />
        </div>
      )}
    </li>
  );
}
