import type { Metadata } from "next";
import { setRequestLocale, getTranslations } from "next-intl/server";
import DiscoveryGuidePage from "@/components/DiscoveryGuidePage";
import { DISCOVERY_CONTENT_LAST_CHECKED, GENEVA_SOURCES, GENEVA_STEP_KEYS } from "@/components/discovery-guide-data";
import { marketingPageMetadata } from "@/lib/seo";

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
  return <DiscoveryGuidePage
    locale={locale}
    path="/guides/qr-menu-geneva"
    metaTitle={t("meta.title")}
    metaDescription={t("meta.description")}
    label={t("label")}
    title={t("title")}
    subtitle={t("subtitle")}
    checked={t("checked", { date: checkedDate })}
    intro={t("intro")}
    stepsTitle={t("stepsTitle")}
    steps={GENEVA_STEP_KEYS.map((key) => ({ key, title: t("steps." + key + ".title"), body: t("steps." + key + ".body") }))}
    fieldCheck={{ title: t("fieldCheck.title"), body: t("fieldCheck.body"), link: { href: "/case/rumi", label: t("fieldCheck.link") } }}
    sourcesTitle={t("sources.title")}
    sourcesNote={t("sources.note", { date: checkedDate })}
    sources={GENEVA_SOURCES.map(({ key, url }) => ({ key, url, label: t("sources.items." + key) }))}
    relatedLabel={t("related.label")}
    related={[
      { href: "/compare/alternatives", label: t("related.alternatives") },
      { href: "/guides/qr-menu-switzerland", label: t("related.switzerland") },
    ]}
  />;
}
