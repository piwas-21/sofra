import { getTranslations } from "next-intl/server";
import { requireAdmin } from "@/lib/rbac";
import { controlLocale } from "@/lib/control-locale";
import { db } from "@/lib/db";
import SignupActions from "@/components/control/SignupActions";

// Direct-restaurant signup pipeline (ADR-004). Leads land here via POST
// /api/signup; the founder moves them CONTACTED → CONVERTED / DECLINED and
// provisions via /admin/onboard. NEW leads sort first (most actionable).

export default async function AdminSignupsPage() {
  await requireAdmin();
  const locale = await controlLocale();
  const t = await getTranslations({ locale, namespace: "control.admin.signups" });
  const signups = await db.signupRequest.findMany({
    orderBy: [{ status: "asc" }, { createdAt: "desc" }],
  });

  const fmtDate = (d: Date) =>
    new Intl.DateTimeFormat(locale, { dateStyle: "medium", timeZone: "UTC" }).format(d);

  return (
    <div className="grid gap-8">
      <h1 className="font-display font-bold text-5xl">{t("title")}</h1>
      {signups.length === 0 && (
        <p className="font-hand text-2xl text-muted-foreground">{t("empty")}</p>
      )}
      <ul className="grid gap-4">
        {signups.map((s) => (
          <li key={s.id} className="hand-drawn-border bg-card p-5 grid gap-3">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <span>
                <span className="font-hand text-2xl font-bold block">{s.restaurantName}</span>
                <span className="font-label text-sm text-muted-foreground">
                  {s.contactName} · {s.email}
                  {s.phone ? ` · ${s.phone}` : ""}
                  {s.city ? ` · ${s.city}` : ""}
                </span>
                {s.desiredSlug && (
                  <span className="font-label text-sm text-muted-foreground block">
                    {t("desiredSlug")}: <span className="font-mono">{s.desiredSlug}</span>
                  </span>
                )}
              </span>
              <span className="font-label text-sm text-muted-foreground text-right">
                <span className="font-mono block">{t(`status.${s.status}`)}</span>
                {fmtDate(s.createdAt)} · {s.locale}
              </span>
            </div>
            {s.message && (
              <p className="font-label text-sm text-muted-foreground whitespace-pre-wrap">
                {s.message}
              </p>
            )}
            <SignupActions id={s.id} />
          </li>
        ))}
      </ul>
    </div>
  );
}
