import type { Metadata } from "next";
import { setRequestLocale, getTranslations } from "next-intl/server";
import { Link } from "@/i18n/navigation";
import Header from "@/components/Header";
import Footer from "@/components/Footer";
import SectionLabel from "@/components/SectionLabel";
import JsonLdScript from "@/components/JsonLdScript";
import CompareTable from "@/components/CompareTable";
import {
  COMPARE_LAST_CHECKED,
  COMPARE_QA_KEYS,
  COMPARE_SOURCES,
  FIT_GF_KEYS,
  FIT_SOFRA_KEYS,
} from "@/components/compare-gloriafood-data";
import { SITE_URL, marketingPageMetadata } from "@/lib/seo";

// Honest, dated SofraPiwas-vs-GloriaFood comparison (AEO plan §2 priority 2).
// Every GloriaFood claim is sourced (see compare-gloriafood-data.ts) —
// re-verify the sources before editing any factual cell.

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "compare" });
  return marketingPageMetadata({
    locale,
    path: "/compare/gloriafood",
    title: t("meta.title"),
    description: t("meta.description"),
  });
}

export default async function CompareGloriaFoodPage({
  params,
}: Readonly<{
  params: Promise<{ locale: string }>;
}>) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations({ locale, namespace: "compare" });
  const checkedDate = new Intl.DateTimeFormat(locale, {
    dateStyle: "long",
    timeZone: "UTC",
  }).format(new Date(COMPARE_LAST_CHECKED));

  const webPage = {
    "@context": "https://schema.org",
    "@type": "WebPage",
    "@id": `${SITE_URL}/${locale}/compare/gloriafood`,
    name: t("meta.title"),
    description: t("meta.description"),
    inLanguage: locale,
    dateModified: COMPARE_LAST_CHECKED,
    isPartOf: { "@id": `${SITE_URL}/#website` },
  };

  return (
    <>
      <JsonLdScript data={[webPage]} />
      <Header />
      <main>
        <article className="mx-auto max-w-4xl px-6 py-craft-section-mobile md:py-craft-section">
          <SectionLabel>{t("label")}</SectionLabel>
          <h1 className="mt-4 font-display font-bold text-5xl md:text-6xl">
            {t("title")}
          </h1>
          <p className="mt-3 max-w-2xl text-muted-foreground">{t("subtitle")}</p>
          <p className="mt-4 font-mono text-xs text-primary">
            <time dateTime={COMPARE_LAST_CHECKED}>
              {t("updated", { date: checkedDate })}
            </time>
          </p>

          <div className="mt-8 space-y-4 max-w-2xl text-muted-foreground leading-relaxed">
            <p>{t("intro1")}</p>
            <p>{t("intro2")}</p>
          </div>

          <CompareTable />
          <p className="mt-4 text-xs text-muted-foreground leading-relaxed">
            {t("disclaimer")}
          </p>

          <section className="mt-12 space-y-8">
            {COMPARE_QA_KEYS.map((key) => (
              <div key={key}>
                <h2 className="font-hand text-3xl font-bold">{t(`qa.${key}.q`)}</h2>
                <p className="mt-2 max-w-2xl text-muted-foreground leading-relaxed">
                  {t(`qa.${key}.a`)}
                </p>
              </div>
            ))}
          </section>

          <div className="mt-12 grid gap-6 md:grid-cols-2">
            <section className="hand-drawn-border bg-card p-6">
              <h2 className="font-hand text-2xl font-bold">{t("fitGf.title")}</h2>
              <ul className="mt-3 space-y-2 text-muted-foreground leading-relaxed list-disc ps-5">
                {FIT_GF_KEYS.map((key) => (
                  <li key={key}>{t(`fitGf.items.${key}`)}</li>
                ))}
              </ul>
            </section>
            <section className="ruled-lines hand-drawn-border bg-muted/40 p-6">
              <h2 className="font-hand text-2xl font-bold">{t("fitSofra.title")}</h2>
              <ul className="mt-3 space-y-2 text-muted-foreground leading-relaxed list-disc ps-5">
                {FIT_SOFRA_KEYS.map((key) => (
                  <li key={key}>{t(`fitSofra.items.${key}`)}</li>
                ))}
              </ul>
            </section>
          </div>

          <section className="mt-12">
            <h2 className="font-hand text-3xl font-bold">{t("sources.title")}</h2>
            <p className="mt-2 text-sm text-muted-foreground">
              {t("sources.note", { date: checkedDate })}
            </p>
            <ul className="mt-3 space-y-1 text-sm">
              {COMPARE_SOURCES.map(({ key, url }) => (
                <li key={key}>
                  <a
                    href={url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="underline decoration-primary/60 underline-offset-4 hover:text-primary transition-colors"
                  >
                    {t(`sources.items.${key}`)} ↗
                  </a>
                </li>
              ))}
            </ul>
          </section>

          <div className="mt-12 hand-drawn-border bg-muted/40 p-8">
            <h2 className="font-hand text-3xl font-bold">{t("ctaTitle")}</h2>
            <p className="mt-2 text-muted-foreground">{t("ctaBody")}</p>
            <div className="mt-6 flex flex-wrap gap-4">
              <Link href="/#waitlist" className="btn-primary">
                {t("ctaButton")}
              </Link>
              <Link href="/case/rumi" className="btn-secondary">
                {t("ctaCase")}
              </Link>
            </div>
          </div>
        </article>
      </main>
      <Footer />
    </>
  );
}
