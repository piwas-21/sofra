import type { Metadata } from "next";
import { setRequestLocale, getTranslations } from "next-intl/server";
import Header from "@/components/Header";
import Footer from "@/components/Footer";
import SectionLabel from "@/components/SectionLabel";
import JsonLdScript from "@/components/JsonLdScript";
import { CHANGELOG_ENTRIES } from "@/components/changelog-data";
import { SITE_URL, marketingPageMetadata } from "@/lib/seo";

// Dated "what's new" entries — freshness signal for answer engines
// (AEO plan §2). Entries live in components/changelog-data.ts + messages.

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "changelog" });
  return marketingPageMetadata({
    locale,
    path: "/changelog",
    title: t("meta.title"),
    description: t("meta.description"),
  });
}

export default async function ChangelogPage({
  params,
}: Readonly<{
  params: Promise<{ locale: string }>;
}>) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations({ locale, namespace: "changelog" });
  const formatDate = (iso: string) =>
    new Intl.DateTimeFormat(locale, { dateStyle: "long", timeZone: "UTC" }).format(
      new Date(iso),
    );

  const webPage = {
    "@context": "https://schema.org",
    "@type": "WebPage",
    "@id": `${SITE_URL}/${locale}/changelog`,
    name: t("meta.title"),
    description: t("meta.description"),
    inLanguage: locale,
    dateModified: CHANGELOG_ENTRIES[0].date,
    isPartOf: { "@id": `${SITE_URL}/#website` },
  };

  return (
    <>
      <JsonLdScript data={[webPage]} />
      <Header />
      <main>
        <section className="mx-auto max-w-3xl px-6 py-craft-section-mobile md:py-craft-section">
          <SectionLabel>{t("label")}</SectionLabel>
          <h1 className="mt-4 font-display font-bold text-5xl md:text-6xl">
            {t("title")}
          </h1>
          <p className="mt-3 max-w-xl text-muted-foreground">{t("subtitle")}</p>

          <ol className="mt-12 space-y-6">
            {CHANGELOG_ENTRIES.map(({ key, date }) => (
              <li key={key} className="hand-drawn-border bg-card px-6 py-5">
                <time dateTime={date} className="font-mono text-xs text-primary">
                  {formatDate(date)}
                </time>
                <h2 className="mt-2 font-hand text-3xl font-bold">
                  {t(`entries.${key}.title`)}
                </h2>
                <p className="mt-2 text-muted-foreground leading-relaxed">
                  {t(`entries.${key}.body`)}
                </p>
              </li>
            ))}
          </ol>
        </section>
      </main>
      <Footer />
    </>
  );
}
