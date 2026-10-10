"use client";

import { useTranslations } from "next-intl";

type PartnerBrandErrorProps = Readonly<{
  error: Error & { digest?: string };
  reset: () => void;
}>;

export default function PartnerBrandError({ reset }: PartnerBrandErrorProps) {
  const t = useTranslations("control.brand");

  return (
    <section role="alert" className="grid gap-4 rounded-craft border-2 border-border bg-card p-6">
      <h1 className="font-display text-3xl font-bold">{t("pageLoadErrorTitle")}</h1>
      <p className="font-label text-muted-foreground">{t("pageLoadError")}</p>
      <button
        type="button"
        onClick={reset}
        className="w-fit rounded-craft border-2 border-foreground px-4 py-2 font-label font-bold"
      >
        {t("retryPage")}
      </button>
    </section>
  );
}
