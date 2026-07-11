import { getTranslations } from "next-intl/server";
import { requireAdmin } from "@/lib/rbac";
import { controlLocale } from "@/lib/control-locale";
import { mollieConfigured } from "@/lib/mollie";
import OnboardPartnerForm from "@/components/control/OnboardPartnerForm";

export default async function AdminOnboardPage() {
  await requireAdmin();
  const locale = await controlLocale();
  const t = await getTranslations({ locale, namespace: "control.admin" });

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

      <section className="hand-drawn-border bg-card p-5">
        <OnboardPartnerForm />
      </section>
    </div>
  );
}
