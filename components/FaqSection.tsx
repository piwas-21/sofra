import { useTranslations } from "next-intl";
import SectionLabel from "./SectionLabel";
import { FAQ_KEYS } from "./faq-data";

/**
 * Visible FAQ — native <details> disclosures (extractable text, no JS).
 * Same message keys feed the FAQPage JSON-LD in JsonLd.tsx.
 */
export default function FaqSection() {
  const t = useTranslations("faq");

  return (
    <section id="faq" className="mx-auto max-w-3xl px-6 py-craft-section-mobile md:py-craft-section">
      <SectionLabel>{t("label")}</SectionLabel>
      <h2 className="mt-4 font-display font-bold text-5xl md:text-6xl">
        {t("title")}
      </h2>
      <p className="mt-3 max-w-xl text-muted-foreground">{t("subtitle")}</p>

      <div className="mt-10 space-y-4">
        {FAQ_KEYS.map((key) => (
          <details
            key={key}
            className="hand-drawn-border bg-card px-5 py-4 group"
          >
            <summary className="cursor-pointer font-hand text-2xl font-bold list-none flex items-baseline justify-between gap-4">
              <span>{t(`items.${key}.q`)}</span>
              <span
                aria-hidden
                className="font-display text-3xl text-primary transition-transform group-open:rotate-45"
              >
                +
              </span>
            </summary>
            <p className="mt-3 text-muted-foreground leading-relaxed">
              {t(`items.${key}.a`)}
            </p>
          </details>
        ))}
      </div>
    </section>
  );
}
