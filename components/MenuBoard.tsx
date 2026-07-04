import { useTranslations } from "next-intl";
import SectionLabel from "./SectionLabel";

export default function MenuBoard() {
  const t = useTranslations("pricing");

  return (
    <section id="pricing" className="mx-auto max-w-6xl px-6 py-craft-section-mobile md:py-craft-section">
      <SectionLabel>{t("label")}</SectionLabel>

      {/* Hand-lettered menu board */}
      <div className="mt-6 max-w-2xl mx-auto hand-drawn-border bg-card p-8 md:p-12 rotate-[0.4deg]">
        <h2 className="font-display font-bold text-5xl md:text-6xl text-center">
          {t("title")}
        </h2>
        <p className="mt-2 font-hand text-2xl text-center text-muted-foreground">
          {t("subtitle")}
        </p>

        <div className="mt-10 space-y-8">
          <div>
            <div className="menu-leaders">
              <span className="font-hand text-3xl font-bold">
                {t("founding.name")}
              </span>
              <span className="font-display text-3xl text-primary whitespace-nowrap">
                {t("founding.price")}
              </span>
            </div>
            <p className="mt-2 text-muted-foreground leading-relaxed">
              {t("founding.detail")}
            </p>
          </div>

          <div>
            <div className="menu-leaders">
              <span className="font-hand text-3xl font-bold">
                {t("regular.name")}
              </span>
              <span className="font-display text-3xl text-craft-saffron-text dark:text-craft-saffron-dark whitespace-nowrap">
                {t("regular.price")}
              </span>
            </div>
            <p className="mt-2 text-muted-foreground leading-relaxed">
              {t("regular.detail")}
            </p>
          </div>
        </div>

        <p className="mt-10 text-center font-label text-sm text-muted-foreground">
          {t("note")}
        </p>
      </div>
    </section>
  );
}
