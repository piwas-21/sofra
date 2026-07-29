import { getTranslations } from "next-intl/server";
import { requireAdmin } from "@/lib/rbac";
import { controlLocale } from "@/lib/control-locale";
import { provisioningConfigured } from "@/lib/provisioning";
import { db } from "@/lib/db";
import { toProvisionPrefill, type ProvisionPrefill } from "@/lib/provision-prefill";
import ProvisionForm from "@/components/control/ProvisionForm";

// Propose a new tenant registry entry (ADR-012). Opens a reviewable PR on the
// deploy repo; a founder merges it, it syncs to the box, then the provision-tenant
// Action runs the script. The control plane never writes the box directly.
//
// Never cached: the lead is re-read per request (mirrors /admin/onboard).
export const dynamic = "force-dynamic";

export default async function AdminProvisionPage({
  searchParams,
}: Readonly<{
  // `from` = a signup-lead id (opaque, never PII in the URL): when present we
  // re-read that lead server-side and pre-fill the form (SOFRA-ONBOARDING-PLAN O1).
  // A repeated key yields string[] in the App Router — normalize to the first.
  searchParams: Promise<{ from?: string | string[] }>;
}>) {
  await requireAdmin();
  const locale = await controlLocale();
  const t = await getTranslations({ locale, namespace: "control.admin" });
  const configured = provisioningConfigured();

  // Prefill from a signup lead when arriving via "Open provisioning" (/admin/signups).
  // Only the id travels in the URL; the PII is fetched here behind requireAdmin.
  const { from: rawFrom } = await searchParams;
  const from = Array.isArray(rawFrom) ? rawFrom[0] : rawFrom;
  let prefill: ProvisionPrefill | undefined;
  if (from) {
    const signup = await db.signupRequest.findUnique({ where: { id: from } });
    if (signup) prefill = toProvisionPrefill(signup);
  }

  return (
    <div className="grid gap-10">
      <div>
        <h1 className="font-display font-bold text-5xl">{t("provision.title")}</h1>
        <p className="mt-2 font-label text-muted-foreground">{t("provision.intro")}</p>
      </div>

      {prefill && (
        <p className="hand-drawn-border bg-card p-4 font-label text-muted-foreground">
          {t("provision.fromSignup", { restaurant: prefill.name })}
        </p>
      )}

      {!configured && (
        <p className="hand-drawn-border bg-card p-4 font-label text-craft-error-text">
          {t("provision.notConfigured")}
        </p>
      )}

      <section className="hand-drawn-border bg-card p-5">
        <ProvisionForm disabled={!configured} prefill={prefill} />
      </section>
    </div>
  );
}
