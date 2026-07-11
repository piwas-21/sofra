import type { Metadata } from "next";
import { setRequestLocale, getTranslations } from "next-intl/server";
import { Link } from "@/i18n/navigation";
import Header from "@/components/Header";
import Footer from "@/components/Footer";
import SectionLabel from "@/components/SectionLabel";
import JsonLdScript from "@/components/JsonLdScript";
import { SITE_URL, marketingPageMetadata } from "@/lib/seo";

// RUMI case study (AEO plan §2 priority 1). Verifiable facts only — the
// quantitative stats section is deliberately absent until the owner can
// publish numbers we can stand behind (no placeholders, no invented metrics).

const RUMI_URL = "https://www.rumirestaurant.ch";
const LIVE_SINCE = "2026-06-29";
const PUBLISHED = "2026-07-10";
const RUN_KEYS = ["ordering", "boards", "reservations", "loyalty", "printing"] as const;

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "caseStudy" });
  return marketingPageMetadata({
    locale,
    path: "/case/rumi",
    title: t("meta.title"),
    description: t("meta.description"),
  });
}

export default async function RumiCaseStudyPage({
  params,
}: Readonly<{
  params: Promise<{ locale: string }>;
}>) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations({ locale, namespace: "caseStudy" });
  const liveSince = new Intl.DateTimeFormat(locale, {
    dateStyle: "long",
    timeZone: "UTC",
  }).format(new Date(LIVE_SINCE));

  const article = {
    "@context": "https://schema.org",
    "@type": "Article",
    headline: t("meta.title"),
    description: t("meta.description"),
    datePublished: PUBLISHED,
    dateModified: PUBLISHED,
    inLanguage: locale,
    mainEntityOfPage: `${SITE_URL}/${locale}/case/rumi`,
    author: { "@type": "Organization", name: "Sofra", url: SITE_URL },
    publisher: { "@type": "Organization", name: "Sofra", url: SITE_URL },
    about: {
      "@type": "Restaurant",
      name: "RUMI Restaurant",
      url: RUMI_URL,
      address: { "@type": "PostalAddress", addressLocality: "Geneva", addressCountry: "CH" },
    },
  };

  const facts: Array<{ key: string; value: string }> = [
    { key: "location", value: t("facts.location.value") },
    { key: "since", value: liveSince },
    { key: "languages", value: t("facts.languages.value") },
    { key: "hosting", value: t("facts.hosting.value") },
  ];

  return (
    <>
      <JsonLdScript data={[article]} />
      <Header />
      <main>
        <article className="mx-auto max-w-3xl px-6 py-craft-section-mobile md:py-craft-section">
          <SectionLabel>{t("label")}</SectionLabel>
          <h1 className="mt-4 font-display font-bold text-5xl md:text-6xl">
            {t("title")}
          </h1>
          <p className="mt-3 max-w-xl text-muted-foreground">{t("subtitle")}</p>

          <dl className="mt-10 grid grid-cols-2 gap-4 md:grid-cols-4">
            {facts.map(({ key, value }) => (
              <div key={key} className="hand-drawn-border bg-card px-4 py-3">
                <dt className="font-label text-xs text-muted-foreground">
                  {t(`facts.${key}.label`)}
                </dt>
                <dd className="mt-1 font-hand text-xl font-bold">{value}</dd>
              </div>
            ))}
          </dl>

          <section className="mt-12">
            <h2 className="font-hand text-4xl font-bold">{t("runs.title")}</h2>
            <p className="mt-3 text-muted-foreground">{t("runs.intro")}</p>
            <ul className="mt-6 space-y-4">
              {RUN_KEYS.map((key) => (
                <li key={key} className="ruled-lines bg-card/60 hand-drawn-border px-5 py-4">
                  <h3 className="font-hand text-2xl font-bold">
                    {t(`runs.items.${key}.title`)}
                  </h3>
                  <p className="mt-1 text-muted-foreground leading-relaxed">
                    {t(`runs.items.${key}.text`)}
                  </p>
                </li>
              ))}
            </ul>
          </section>

          <section className="mt-12">
            <h2 className="font-hand text-4xl font-bold">{t("languagesSection.title")}</h2>
            <p className="mt-3 text-muted-foreground leading-relaxed">
              {t("languagesSection.body")}
            </p>
          </section>

          <section className="mt-12">
            <h2 className="font-hand text-4xl font-bold">{t("infra.title")}</h2>
            <p className="mt-3 text-muted-foreground leading-relaxed">
              {t("infra.body", { date: liveSince })}
            </p>
          </section>

          <section className="mt-12">
            <h2 className="font-hand text-4xl font-bold">{t("numbers.title")}</h2>
            <p className="mt-3 text-muted-foreground leading-relaxed">{t("numbers.body")}</p>
          </section>

          <div className="mt-12 hand-drawn-border bg-muted/40 p-8">
            <h2 className="font-hand text-3xl font-bold">{t("ctaTitle")}</h2>
            <p className="mt-2 text-muted-foreground">{t("ctaBody")}</p>
            <div className="mt-6 flex flex-wrap gap-4">
              <Link href="/#waitlist" className="btn-primary">
                {t("ctaButton")}
              </Link>
              <a href={RUMI_URL} target="_blank" rel="noopener noreferrer" className="btn-secondary">
                {t("visit")} ↗
              </a>
            </div>
          </div>
        </article>
      </main>
      <Footer />
    </>
  );
}
