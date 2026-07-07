import Link from "next/link";
import { useTranslations } from "next-intl";
import SectionLabel from "./SectionLabel";
import PartnerForm from "./PartnerForm";

export default function PartnerSection() {
  const t = useTranslations("partner");

  return (
    <section id="partner">
      <div className="mx-auto max-w-3xl px-6 py-craft-section-mobile md:py-craft-section">
        <SectionLabel>{t("label")}</SectionLabel>
        <h2 className="mt-4 font-display font-bold text-5xl md:text-6xl">{t("title")}</h2>
        <p className="mt-3 max-w-xl text-muted-foreground">{t("subtitle")}</p>

        <ul className="mt-8 grid gap-3 sm:grid-cols-3">
          {(["find", "onboard", "earn"] as const).map((k) => (
            <li key={k} className="hand-drawn-border bg-card p-4">
              <h3 className="font-hand text-2xl font-bold">{t(`points.${k}.title`)}</h3>
              <p className="mt-1 text-sm text-muted-foreground">{t(`points.${k}.text`)}</p>
            </li>
          ))}
        </ul>

        <div className="mt-10">
          <PartnerForm />
        </div>
        <p className="mt-6 font-label text-sm text-muted-foreground">
          {t("loginHint")}{" "}
          <Link href="/login" className="underline">
            {t("loginLink")}
          </Link>
        </p>
      </div>
    </section>
  );
}
