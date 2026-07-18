import { getTranslations } from "next-intl/server";
import { requireAdmin } from "@/lib/rbac";
import { controlLocale } from "@/lib/control-locale";
import { mollieConfigured } from "@/lib/mollie";
import { db } from "@/lib/db";
import { loadTenantRegistry } from "@/lib/tenant-registry";
import {
  toOnboardPrefill,
  toOnboardTenants,
  type OnboardPrefill,
  type OnboardTenant,
} from "@/lib/onboard-tenants";
import OnboardPartnerForm from "@/components/control/OnboardPartnerForm";

// The registry file changes underneath us (rsync on deploy-repo push) and the
// billing join must reflect the live DB — always re-read, never a build snapshot
// (mirrors /admin/tenants).
export const dynamic = "force-dynamic";

export default async function AdminOnboardPage({
  searchParams,
}: Readonly<{
  // `from` = a signup-lead id (opaque, never PII in the URL): when present we
  // re-read that lead server-side and pre-fill the form (ADR-004 conversion).
  // A repeated key yields string[] in the App Router — normalize to the first.
  searchParams: Promise<{ from?: string | string[] }>;
}>) {
  await requireAdmin();
  const locale = await controlLocale();
  const t = await getTranslations({ locale, namespace: "control.admin" });

  // Prefill from a signup lead when arriving via "Open onboarding" (/admin/signups).
  // Only the id travels in the URL; the PII is fetched here behind requireAdmin.
  const { from: rawFrom } = await searchParams;
  const from = Array.isArray(rawFrom) ? rawFrom[0] : rawFrom;
  let prefill: OnboardPrefill | undefined;
  if (from) {
    const signup = await db.signupRequest.findUnique({ where: { id: from } });
    if (signup) prefill = toOnboardPrefill(signup);
  }

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

      {prefill && (
        <p className="hand-drawn-border bg-card p-4 font-label text-muted-foreground">
          {t("onboard.fromSignup", { restaurant: prefill.restaurantName })}
        </p>
      )}

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
        <OnboardPartnerForm tenants={tenants} prefill={prefill} />
      </section>
    </div>
  );
}
