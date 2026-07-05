import { useTranslations } from "next-intl";
import SectionLabel from "./SectionLabel";
import IntentLink from "./IntentLink";

const RUMI_URL = "https://www.rumirestaurant.ch";

export default function ShowcaseSection() {
  const t = useTranslations("showcase");

  return (
    <section id="showcase">
      <div className="mx-auto max-w-6xl px-6 py-craft-section-mobile md:py-craft-section">
        <SectionLabel>{t("label")}</SectionLabel>
        <h2 className="mt-4 font-display font-bold text-5xl md:text-6xl">
          {t("title")}
        </h2>
        <p className="mt-3 max-w-xl text-muted-foreground">{t("subtitle")}</p>

        <div className="mt-12 grid gap-10 md:grid-cols-2 md:items-stretch">
          {/* Tenant 1, live — the reference card */}
          <div className="hand-drawn-border bg-card p-8 rotate-[-0.6deg] flex flex-col">
            <span className="stamp self-start font-mono text-xs text-primary px-3 py-1.5">
              {t("cardStamp")}
            </span>
            <h3 className="mt-5 font-hand text-4xl font-bold">
              {t("cardTitle")}
            </h3>
            <p className="mt-3 text-muted-foreground leading-relaxed">
              {t("cardBody")}
            </p>
            <p className="mt-4 font-hand text-2xl text-craft-olive-text dark:text-craft-olive-dark">
              {t("cardHint")}
            </p>
            <div className="mt-auto pt-6">
              <a
                href={RUMI_URL}
                target="_blank"
                rel="noopener noreferrer"
                className="btn-primary"
              >
                {t("visit")} ↗
              </a>
            </div>
          </div>

          {/* Your place next — demo / call / quote */}
          <div className="ruled-lines bg-muted/40 hand-drawn-border p-8 rotate-[0.5deg] flex flex-col">
            <h3 className="font-hand text-4xl font-bold">{t("ctaTitle")}</h3>
            <p className="mt-3 text-muted-foreground leading-relaxed">
              {t("ctaBody")}
            </p>
            <div className="mt-auto pt-6 flex flex-wrap gap-4">
              <IntentLink intent="demo" className="btn-primary">
                {t("demo")}
              </IntentLink>
              <IntentLink intent="call" className="btn-secondary">
                {t("call")}
              </IntentLink>
              <IntentLink intent="quote" className="btn-secondary">
                {t("quote")}
              </IntentLink>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
