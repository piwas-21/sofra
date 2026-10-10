import { getTranslations } from "next-intl/server";
import { controlLocale } from "@/lib/control-locale";

export default async function PartnerBrandLoading() {
  const locale = await controlLocale();
  const t = await getTranslations({ locale, namespace: "control.brand" });

  return (
    <div className="grid gap-8" aria-busy="true">
      <p role="status" aria-live="polite" className="sr-only">{t("pageLoading")}</p>
      <section className="grid gap-3" aria-hidden="true">
        <div className="h-12 w-64 animate-pulse rounded bg-muted" />
        <div className="h-5 w-full max-w-2xl animate-pulse rounded bg-muted" />
        <div className="h-4 w-full max-w-xl animate-pulse rounded bg-muted" />
      </section>
      <section className="grid gap-4 rounded-craft border-2 border-border p-6" aria-hidden="true">
        <div className="h-8 w-56 animate-pulse rounded bg-muted" />
        <div className="h-16 animate-pulse rounded bg-muted" />
        <div className="h-16 animate-pulse rounded bg-muted" />
      </section>
    </div>
  );
}
