import type { Metadata } from "next";
import { setRequestLocale, getTranslations } from "next-intl/server";
import { Link } from "@/i18n/navigation";
import Header from "@/components/Header";
import Footer from "@/components/Footer";
import SectionLabel from "@/components/SectionLabel";
import JsonLdScript from "@/components/JsonLdScript";
import {
  ALTERNATIVE_FAQ_KEYS,
  ALTERNATIVE_PROVIDER_KEYS,
  ALTERNATIVE_PROVIDER_SOURCE_KEYS,
  ALTERNATIVES_SOURCES,
  DISCOVERY_CONTENT_LAST_CHECKED,
} from "@/components/discovery-guide-data";
import { SITE_URL, marketingPageMetadata } from "@/lib/seo";

export async function generateMetadata({ params }: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "discovery.alternatives" });
  return marketingPageMetadata({
    locale,
    path: "/compare/alternatives",
    title: t("meta.title"),
    description: t("meta.description"),
  });
}

export default async function AlternativesPage({ params }: Readonly<{
  params: Promise<{ locale: string }>;
}>) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations({ locale, namespace: "discovery.alternatives" });
  const checkedDate = new Intl.DateTimeFormat(locale, {
    dateStyle: "long",
    timeZone: "UTC",
  }).format(new Date(DISCOVERY_CONTENT_LAST_CHECKED));
  const webPage = {
    "@context": "https://schema.org",
    "@type": "WebPage",
    "@id": SITE_URL + "/" + locale + "/compare/alternatives",
    name: t("meta.title"),
    description: t("meta.description"),
    inLanguage: locale,
    dateModified: DISCOVERY_CONTENT_LAST_CHECKED,
    isPartOf: { "@id": SITE_URL + "/#website" },
  };
  const faqPage = {
    "@context": "https://schema.org",
    "@type": "FAQPage",
    mainEntity: ALTERNATIVE_FAQ_KEYS.map((key) => ({
      "@type": "Question",
      name: t("faq." + key + ".q"),
      acceptedAnswer: { "@type": "Answer", text: t("faq." + key + ".a") },
    })),
  };
  const sourceFor = (key: string) => ALTERNATIVES_SOURCES.find((source) => source.key === key);

  return (
    <>
      <JsonLdScript data={[webPage, faqPage]} />
      <Header />
      <main>
        <article className="mx-auto max-w-6xl px-6 py-craft-section-mobile md:py-craft-section">
          <SectionLabel>{t("label")}</SectionLabel>
          <h1 className="mt-4 max-w-4xl font-display font-bold text-5xl md:text-6xl">{t("title")}</h1>
          <p className="mt-3 max-w-3xl text-muted-foreground leading-relaxed">{t("subtitle")}</p>
          <p className="mt-4 font-mono text-xs text-primary">
            <time dateTime={DISCOVERY_CONTENT_LAST_CHECKED}>{t("checked", { date: checkedDate })}</time>
          </p>
          <div className="mt-8 max-w-3xl space-y-4 text-muted-foreground leading-relaxed">
            <p>{t("intro")}</p>
            <p>{t("scopeNote")}</p>
          </div>

          <section className="mt-10" aria-labelledby="alternatives-table">
            <h2 id="alternatives-table" className="font-hand text-3xl font-bold">{t("table.title")}</h2>
            <p className="mt-2 text-sm text-muted-foreground">{t("table.note", { date: checkedDate })}</p>
            <section aria-label={t("table.caption")} className="mt-4 overflow-x-auto hand-drawn-border">
              <table className="w-full min-w-[900px] border-collapse text-start text-sm">
                <caption className="sr-only">{t("table.caption")}</caption>
                <thead className="bg-muted/50">
                  <tr>
                    {["provider", "fit", "published", "verify"].map((key) => (
                      <th key={key} scope="col" className="p-4 font-label font-bold">{t("table.columns." + key)}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {ALTERNATIVE_PROVIDER_KEYS.map((key) => (
                    <tr key={key} className="border-t border-border align-top">
                      <th scope="row" className="p-4 font-label font-bold">{t("providers." + key + ".name")}</th>
                      <td className="p-4 text-muted-foreground leading-relaxed">{t("providers." + key + ".fit")}</td>
                      <td className="p-4 text-muted-foreground leading-relaxed">
                        {t("providers." + key + ".published")}
                        <ul className="mt-3 space-y-1 text-xs">
                          {ALTERNATIVE_PROVIDER_SOURCE_KEYS[key].map((sourceKey) => {
                            const source = sourceFor(sourceKey);
                            return source ? (
                              <li key={sourceKey}>
                                <a href={source.url} target="_blank" rel="noopener noreferrer" className="underline decoration-primary/60 underline-offset-4 hover:text-primary">
                                  {t("sources.items." + sourceKey)} ↗
                                </a>
                              </li>
                            ) : null;
                          })}
                        </ul>
                      </td>
                      <td className="p-4 text-muted-foreground leading-relaxed">{t("providers." + key + ".verify")}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </section>
          </section>

          <section className="mt-12">
            <h2 className="font-hand text-3xl font-bold">{t("transition.title")}</h2>
            <p className="mt-2 max-w-3xl text-muted-foreground leading-relaxed">{t("transition.intro")}</p>
            <ol className="mt-4 grid gap-4 md:grid-cols-2">
              {["inventory", "export", "pilot", "cutover"].map((key, index) => (
                <li key={key} className="hand-drawn-border bg-card p-5">
                  <span className="font-mono text-xs text-primary">{index + 1}</span>
                  <p className="mt-2 text-muted-foreground leading-relaxed">{t("transition.steps." + key)}</p>
                </li>
              ))}
            </ol>
          </section>

          <section className="mt-12 space-y-7">
            {ALTERNATIVE_FAQ_KEYS.map((key) => (
              <div key={key}>
                <h2 className="font-hand text-2xl font-bold">{t("faq." + key + ".q")}</h2>
                <p className="mt-2 max-w-3xl text-muted-foreground leading-relaxed">{t("faq." + key + ".a")}</p>
              </div>
            ))}
          </section>

          <section className="mt-12">
            <h2 className="font-hand text-3xl font-bold">{t("sources.title")}</h2>
            <p className="mt-2 text-sm text-muted-foreground">{t("sources.note", { date: checkedDate })}</p>
            <ul className="mt-3 space-y-2 text-sm">
              {ALTERNATIVES_SOURCES.map(({ key, url }) => (
                <li key={key}><a href={url} target="_blank" rel="noopener noreferrer" className="underline decoration-primary/60 underline-offset-4 hover:text-primary">{t("sources.items." + key)} ↗</a></li>
              ))}
            </ul>
          </section>

          <nav aria-label={t("related.label")} className="mt-12 flex flex-wrap gap-x-6 gap-y-3">
            <Link href="/compare/gloriafood" className="underline decoration-primary/60 underline-offset-4">{t("related.gloriafood")}</Link>
            <Link href="/guides/qr-menu-switzerland" className="underline decoration-primary/60 underline-offset-4">{t("related.switzerland")}</Link>
            <Link href="/guides/qr-menu-geneva" className="underline decoration-primary/60 underline-offset-4">{t("related.geneva")}</Link>
          </nav>
        </article>
      </main>
      <Footer />
    </>
  );
}
