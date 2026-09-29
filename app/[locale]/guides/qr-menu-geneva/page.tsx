import type { Metadata } from "next";
import { setRequestLocale, getTranslations } from "next-intl/server";
import { Link } from "@/i18n/navigation";
import Header from "@/components/Header";
import Footer from "@/components/Footer";
import SectionLabel from "@/components/SectionLabel";
import JsonLdScript from "@/components/JsonLdScript";
import { DISCOVERY_CONTENT_LAST_CHECKED, GENEVA_SOURCES, GENEVA_STEP_KEYS } from "@/components/discovery-guide-data";
import { SITE_URL, marketingPageMetadata } from "@/lib/seo";

export async function generateMetadata({ params }: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "discovery.geneva" });
  return marketingPageMetadata({
    locale,
    path: "/guides/qr-menu-geneva",
    title: t("meta.title"),
    description: t("meta.description"),
  });
}

export default async function GenevaQrGuide({ params }: Readonly<{
  params: Promise<{ locale: string }>;
}>) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations({ locale, namespace: "discovery.geneva" });
  const checkedDate = new Intl.DateTimeFormat(locale, { dateStyle: "long", timeZone: "UTC" }).format(new Date(DISCOVERY_CONTENT_LAST_CHECKED));
  const webPage = {
    "@context": "https://schema.org",
    "@type": "WebPage",
    "@id": SITE_URL + "/" + locale + "/guides/qr-menu-geneva",
    name: t("meta.title"),
    description: t("meta.description"),
    inLanguage: locale,
    dateModified: DISCOVERY_CONTENT_LAST_CHECKED,
    isPartOf: { "@id": SITE_URL + "/#website" },
  };

  return (
    <>
      <JsonLdScript data={[webPage]} />
      <Header />
      <main>
        <article className="mx-auto max-w-3xl px-6 py-craft-section-mobile md:py-craft-section">
          <SectionLabel>{t("label")}</SectionLabel>
          <h1 className="mt-4 font-display font-bold text-5xl md:text-6xl">{t("title")}</h1>
          <p className="mt-3 text-muted-foreground leading-relaxed">{t("subtitle")}</p>
          <p className="mt-4 font-mono text-xs text-primary"><time dateTime={DISCOVERY_CONTENT_LAST_CHECKED}>{t("checked", { date: checkedDate })}</time></p>
          <p className="mt-8 text-muted-foreground leading-relaxed">{t("intro")}</p>
          <h2 className="mt-10 font-hand text-3xl font-bold">{t("stepsTitle")}</h2>
          <ol className="mt-4 space-y-5">
            {GENEVA_STEP_KEYS.map((key, index) => (
              <li key={key} className="hand-drawn-border bg-card p-5">
                <span className="font-mono text-xs text-primary">{index + 1}</span>
                <h3 className="mt-2 font-label text-lg font-bold">{t("steps." + key + ".title")}</h3>
                <p className="mt-2 text-muted-foreground leading-relaxed">{t("steps." + key + ".body")}</p>
              </li>
            ))}
          </ol>
          <aside className="mt-10 hand-drawn-border bg-muted/40 p-6">
            <h2 className="font-hand text-2xl font-bold">{t("fieldCheck.title")}</h2>
            <p className="mt-2 text-muted-foreground leading-relaxed">{t("fieldCheck.body")}</p>
            <Link href="/case/rumi" className="mt-4 inline-block underline decoration-primary/60 underline-offset-4">{t("fieldCheck.link")}</Link>
          </aside>
          <section className="mt-12">
            <h2 className="font-hand text-3xl font-bold">{t("sources.title")}</h2>
            <p className="mt-2 text-sm text-muted-foreground">{t("sources.note", { date: checkedDate })}</p>
            <ul className="mt-3 space-y-2 text-sm">
              {GENEVA_SOURCES.map(({ key, url }) => (
                <li key={key}><a href={url} target="_blank" rel="noopener noreferrer" className="underline decoration-primary/60 underline-offset-4 hover:text-primary">{t("sources.items." + key)} ↗</a></li>
              ))}
            </ul>
          </section>
          <nav aria-label={t("related.label")} className="mt-12 flex flex-wrap gap-x-6 gap-y-3">
            <Link href="/compare/alternatives" className="underline decoration-primary/60 underline-offset-4">{t("related.alternatives")}</Link>
            <Link href="/guides/qr-menu-switzerland" className="underline decoration-primary/60 underline-offset-4">{t("related.switzerland")}</Link>
          </nav>
        </article>
      </main>
      <Footer />
    </>
  );
}
