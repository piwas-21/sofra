import { getTranslations } from "next-intl/server";
import { requireAdmin } from "@/lib/rbac";
import { controlLocale } from "@/lib/control-locale";
import { mollieConfigured } from "@/lib/mollie";
import { db } from "@/lib/db";
import { loadTenantRegistry } from "@/lib/tenant-registry";
import { toOnboardTenants, type OnboardTenant } from "@/lib/onboard-tenants";
import OnboardPartnerForm from "@/components/control/OnboardPartnerForm";

// The registry file changes underneath us (rsync on deploy-repo push) and the
// billing join must reflect the live DB — always re-read, never a build snapshot
// (mirrors /admin/tenants).
export const dynamic = "force-dynamic";

export default async function AdminOnboardPage() {
  await requireAdmin();
  const locale = await controlLocale();
  const t = await getTranslations({ locale, namespace: "control.admin" });

  // Registry⋈billing join (same pattern as /admin/tenants): compute which
  // registry tenants are partner-free so the form can offer a picker. If the
  // registry can't be read, fall back to the free-text form + an inline note.
  const registry = await loadTenantRegistry();
  let tenants: OnboardTenant[] | undefined;
  if (registry.ok) {
    const billings = await db.tenantBilling.findMany({ select: { tenantSlug: true } });
    const onboardedSlugs = new Set(billings.map((b) => b.tenantSlug));
    tenants = toOnboardTenants(registry.tenants, onboardedSlugs);
  }

  return (
    <div className="grid gap-10">
      <div>
        <h1 className="font-display font-bold text-5xl">{t("onboard.title")}</h1>
        <p className="mt-2 font-label text-muted-foreground">{t("onboard.intro")}</p>
      </div>

      {!mollieConfigured() && (
        <p className="hand-drawn-border bg-card p-4 font-label text-craft-error-text">
          {t("onboard.mollieMissing")}
        </p>
      )}

      {!registry.ok && (
        <p className="hand-drawn-border bg-card p-4 font-label text-craft-error-text">
          {t("onboard.registryUnavailable", { error: registry.error })}
        </p>
      )}

      <section className="hand-drawn-border bg-card p-5">
        <OnboardPartnerForm tenants={tenants} />
      </section>
    </div>
  );
}
