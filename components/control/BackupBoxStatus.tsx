import { shortDate } from "@/lib/format";
import { BOX_QUIET_AFTER_HOURS, hoursSince } from "@/lib/backup-health";
import type { BackupBoxRow } from "@/lib/backup-overview";

// Whether each box is still talking to us.
//
// This sits ABOVE the tenant list on purpose. A quiet box does not make its
// tenants unprotected — it makes them UNKNOWN, and every per-tenant age below
// becomes a memory of the last report rather than an observation. Reading the
// list without reading this is how a page like that misleads.

type Translator = (key: string, values?: Record<string, string | number>) => string;

export default function BackupBoxStatus({
  boxes,
  now,
  t,
}: Readonly<{ boxes: BackupBoxRow[]; now: number; t: Translator }>) {
  if (boxes.length === 0) {
    // Not "all good" — nothing has EVER reported, which on a platform with live
    // tenants means the agent is not deployed. Silence would read as calm.
    return (
      <p role="alert" className="hand-drawn-border bg-card p-4 font-label text-craft-error-text">
        {t("boxes.none", { hours: BOX_QUIET_AFTER_HOURS })}
      </p>
    );
  }

  return (
    <ul className="grid gap-2 sm:grid-cols-2">
      {boxes.map((b) => {
        const hours = b.lastReportAt ? hoursSince(b.lastReportAt, new Date(now)) : null;
        return (
          <li key={b.box} className="hand-drawn-border bg-card p-4">
            <span className="font-hand text-xl font-bold">{b.box}</span>
            <span
              className={`ml-3 font-label text-sm ${
                b.quiet
                  ? "text-craft-error-text dark:text-craft-error"
                  : "text-craft-success-text dark:text-craft-success"
              }`}
              role={b.quiet ? "alert" : undefined}
            >
              {b.quiet ? t("boxes.quiet", { hours: hours ?? 0 }) : t("boxes.reporting")}
            </span>
            <span className="block font-label text-sm text-muted-foreground">
              {t("boxes.artifacts", { count: b.artifacts })}
              {b.lastReportAt ? ` · ${t("boxes.lastReport", { date: shortDate(b.lastReportAt) })}` : ""}
            </span>
          </li>
        );
      })}
    </ul>
  );
}
