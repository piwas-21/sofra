import { getTranslations } from "next-intl/server";
import { requireAdmin } from "@/lib/rbac";
import { controlLocale } from "@/lib/control-locale";
import { db } from "@/lib/db";
import { eur } from "@/lib/format";
import { loadTenantRegistry } from "@/lib/tenant-registry";
import { checkSlug } from "@/lib/slug-availability";
import { failedByAction } from "@/lib/email-delivery";
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

  // A lead's desiredSlug is a wish, stored verbatim. Judge it HERE, where the
  // founder is about to act on it, rather than at intake where rejecting it would
  // cost a lead. An unreadable registry still lets the reserved-word verdict
  // through; only "taken" needs the tenant list.
  const registry = await loadTenantRegistry();
  const takenSlugs = registry.ok ? registry.tenants.map((r) => r.slug) : [];

  // G16. The welcome mail is the customer's only way into an account that has no password, and
  // `sendEmail` reports a failure by returning rather than throwing — so G5 made that failure
  // durable and this is what finally shows it. Absence of a row means "nothing recorded", not
  // "delivered": every lead from before G5 is in exactly that state, and only failures are written.
  const welcomeFailed = await failedByAction(
    "signup.welcome.failed",
    signups.map((s) => s.id),
  );

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
                    {(() => {
                      const verdict = checkSlug(s.desiredSlug, takenSlugs);
                      // "available" is the expected case and needs no badge —
                      // flagging every healthy lead would bury the two that need
                      // a decision before provisioning.
                      if (verdict === "available") return null;
                      return (
                        <span className="ml-2 font-mono text-craft-error-text">
                          {t(`slugVerdict.${verdict}`)}
                        </span>
                      );
                    })()}
                  </span>
                )}
              </span>
              <span className="font-label text-sm text-muted-foreground text-right">
                <span className="font-mono block">{t(`status.${s.status}`)}</span>
                {fmtDate(s.createdAt)} · {s.locale}
                {welcomeFailed.has(s.id) && (
                  <span className="mt-1 block font-mono text-craft-error-text">
                    {t("welcomeFailed")}
                  </span>
                )}
              </span>
            </div>
            {/* Configurator answers (O1). Absent on leads captured before it
                shipped, and on anyone who submitted without choosing — in both
                cases the founder still picks at /admin/provision. */}
            {s.modules && (
              <dl className="font-label text-sm grid gap-1 sm:grid-cols-[auto_1fr] sm:gap-x-3">
                <dt className="text-muted-foreground">{t("chosenModules")}</dt>
                <dd className="font-mono">{s.modules}</dd>
                <dt className="text-muted-foreground">{t("chosenTheme")}</dt>
                <dd className="font-mono">{s.template ?? "—"}</dd>
                <dt className="text-muted-foreground">{t("chosenLanguages")}</dt>
                <dd className="font-mono">{s.languages ?? "—"}</dd>
                <dt className="text-muted-foreground">{t("chosenCurrency")}</dt>
                <dd className="font-mono">{s.currency ?? "—"}</dd>
                {s.quotedCents !== null && (
                  <>
                    <dt className="text-muted-foreground">{t("quoted")}</dt>
                    <dd className="font-bold">{eur(s.quotedCents)}</dd>
                  </>
                )}
              </dl>
            )}
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
