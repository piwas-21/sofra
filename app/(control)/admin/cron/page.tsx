import { getTranslations } from "next-intl/server";
import { requireAdmin } from "@/lib/rbac";
import { controlLocale } from "@/lib/control-locale";
import { cronFreshness, type CronFreshnessRow } from "@/lib/cron-freshness";

// Always fresh: a cached "everything ran recently" is the one answer this page must
// never give. It is the page you open BECAUSE you suspect nothing has run.
export const dynamic = "force-dynamic";

function humanAge(ageMs: number, t: (k: string, v?: Record<string, string | number>) => string): string {
  const minutes = Math.floor(ageMs / 60000);
  if (minutes < 60) return t("ageMinutes", { count: minutes });
  const hours = Math.floor(minutes / 60);
  if (hours < 48) return t("ageHours", { count: hours });
  return t("ageDays", { count: Math.floor(hours / 24) });
}

export default async function AdminCronPage() {
  await requireAdmin();
  const locale = await controlLocale();
  const t = await getTranslations({ locale, namespace: "control.admin.cron" });

  const rows: CronFreshnessRow[] = await cronFreshness();
  const stale = rows.filter((r) => r.status !== "fresh");

  return (
    <div className="grid gap-10">
      <div>
        <h1 className="font-display font-bold text-5xl">{t("title")}</h1>
        <p className="mt-2 font-label text-muted-foreground">{t("intro")}</p>
      </div>

      {/* The headline first. A reader who has to assemble the verdict by scanning four
          rows is a reader who assembles it wrong at 2am. */}
      {stale.length > 0 ? (
        <p role="alert" className="hand-drawn-border bg-card p-4 font-label text-craft-error-text">
          {t("attention", { count: stale.length, total: rows.length })}
        </p>
      ) : (
        <p className="hand-drawn-border bg-card p-4 font-label text-craft-success-text">
          {t("allFresh", { count: rows.length })}
        </p>
      )}

      <ul className="grid gap-4">
        {rows.map((r) => (
          <li key={r.sweep} className="hand-drawn-border bg-card p-6 grid gap-2">
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <h2 className="font-hand text-3xl font-bold">{r.label}</h2>
              <span
                className={
                  r.status === "fresh"
                    ? "font-label text-craft-success-text"
                    : "font-label text-craft-error-text"
                }
              >
                {t(`status.${r.status}`)}
              </span>
            </div>
            <p className="font-mono text-xs text-muted-foreground">
              {r.lastRunAt
                ? t("lastRan", {
                    when: r.lastRunAt.toISOString().replace("T", " ").slice(0, 16),
                    ago: humanAge(r.ageMs ?? 0, t),
                  })
                : t("neverRan")}
            </p>
            <p className="font-label text-sm text-muted-foreground">
              {t("budget", { hours: Math.round(r.budgetMs / 3600000) })}
            </p>
          </li>
        ))}
      </ul>

      <p className="font-label text-sm text-muted-foreground">{t("footnote")}</p>
    </div>
  );
}
