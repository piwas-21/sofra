import { useTranslations } from "next-intl";
import SectionLabel from "./SectionLabel";

const steps = ["one", "two", "three"] as const;

export default function HowItWorks() {
  const t = useTranslations("how");

  return (
    <section className="bg-muted/40">
      <div className="mx-auto max-w-6xl px-6 py-craft-section-mobile md:py-craft-section">
        <SectionLabel>{t("label")}</SectionLabel>
        <h2 className="mt-4 font-display font-bold text-5xl md:text-6xl">
          {t("title")}
        </h2>

        <ol className="mt-12 grid gap-10 md:grid-cols-3">
          {steps.map((step, i) => (
            <li key={step} className="ruled-lines bg-card/60 p-6 hand-drawn-border">
              <span className="font-display text-6xl text-primary leading-none">
                {i + 1}
              </span>
              <h3 className="mt-3 font-hand text-3xl font-bold">
                {t(`steps.${step}.title`)}
              </h3>
              <p className="mt-2 text-muted-foreground leading-relaxed">
                {t(`steps.${step}.text`)}
              </p>
            </li>
          ))}
        </ol>
      </div>
    </section>
  );
}
