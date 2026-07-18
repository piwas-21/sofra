import { getTranslations } from "next-intl/server";
import { requireAdmin } from "@/lib/rbac";
import { controlLocale } from "@/lib/control-locale";
import { provisioningConfigured } from "@/lib/provisioning";
import ProvisionForm from "@/components/control/ProvisionForm";

// Propose a new tenant registry entry (ADR-012). Opens a reviewable PR on the
// deploy repo; a founder merges it, it syncs to the box, then the provision-tenant
// Action runs the script. The control plane never writes the box directly.
export default async function AdminProvisionPage() {
  await requireAdmin();
  const locale = await controlLocale();
  const t = await getTranslations({ locale, namespace: "control.admin" });
  const configured = provisioningConfigured();

  return (
    <div className="grid gap-10">
      <div>
        <h1 className="font-display font-bold text-5xl">{t("provision.title")}</h1>
        <p className="mt-2 font-label text-muted-foreground">{t("provision.intro")}</p>
      </div>

      {!configured && (
        <p className="hand-drawn-border bg-card p-4 font-label text-craft-error-text">
          {t("provision.notConfigured")}
        </p>
      )}

      <section className="hand-drawn-border bg-card p-5">
        <ProvisionForm disabled={!configured} />
      </section>
    </div>
  );
}
